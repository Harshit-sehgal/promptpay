import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { acquireCronLease } from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';

/**
 * Campaign spend guardrail cron.
 *
 * Active campaigns can race against budget exhaustion or advertiser balance
 * depletion between ad requests. While the serving path atomically rejects
 * individual impressions that would overspend, a campaign that hits its
 * budget or runs out of advertiser funds should be paused so it stops
 * appearing in `requestAd` eligibility scans and advertisers get a clear
 * signal.
 *
 * This cron runs periodically (default 5 minutes), scans active campaigns,
 * and auto-pauses any campaign where:
 *   - budgetSpentMinor >= budgetTotalMinor (budget exhausted), or
 *   - the advertiser's funded balance in the campaign currency is zero/negative.
 *
 * Pausing is idempotent and audited. The cron uses a cross-replica lease so
 * only one API instance performs the scan in a multi-instance deployment.
 */
@Injectable()
export class CampaignSpendGuardCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CampaignSpendGuardCron.name);
  private readonly ownerId = randomUUID();
  private intervalId?: NodeJS.Timeout;
  private running = false;

  private readonly INTERVAL_MS = Math.min(
    Math.max(Number(process.env.CAMPAIGN_SPEND_GUARD_INTERVAL_MS) || 300_000, 30_000),
    3_600_000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Starting campaign spend guard cron...');
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Campaign spend guard cron stopped.');
    }
  }

  async tick(): Promise<{ paused: number; scanned: number }> {
    if (this.running) {
      this.logger.warn('Campaign spend guard already running — skipping overlapping run');
      return { paused: 0, scanned: 0 };
    }
    this.running = true;
    try {
      if (
        !(await acquireCronLease(
          this.prisma,
          'campaign-spend-guard',
          this.ownerId,
          this.INTERVAL_MS - 1_000,
        ))
      ) {
        return { paused: 0, scanned: 0 };
      }

      const campaigns = await this.prisma.campaign.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          name: true,
          advertiserId: true,
          currency: true,
          budgetTotalMinor: true,
          budgetSpentMinor: true,
          budgetReservedMinor: true,
        },
      });

      // Batch balance lookups by advertiser+currency to avoid N+1 queries.
      const balanceMap = await this.getAdvertiserBalances(campaigns);

      let paused = 0;
      for (const campaign of campaigns) {
        const reason = this.evaluateCampaign(campaign, balanceMap);
        if (reason) {
          const didPause = await this.pauseCampaign(campaign, reason);
          if (didPause) paused++;
        }
      }

      if (paused > 0) {
        this.logger.log(`Campaign spend guard paused ${paused} campaign(s).`);
      }
      return { paused, scanned: campaigns.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Campaign spend guard failed: ${msg}`);
      return { paused: 0, scanned: 0 };
    } finally {
      this.running = false;
    }
  }

  private async getAdvertiserBalances(
    campaigns: Array<{ advertiserId: string; currency: string }>,
  ): Promise<Map<string, bigint>> {
    const keys = new Map<string, { advertiserId: string; currency: string }>();
    for (const c of campaigns) {
      keys.set(`${c.advertiserId}:${c.currency}`, {
        advertiserId: c.advertiserId,
        currency: c.currency,
      });
    }
    const balances = new Map<string, bigint>();
    await Promise.all(
      [...keys.values()].map(async ({ advertiserId, currency }) => {
        const balance = await getAdvertiserBalance(this.prisma, advertiserId, currency);
        balances.set(`${advertiserId}:${currency}`, balance);
      }),
    );
    return balances;
  }

  private evaluateCampaign(
    campaign: {
      id: string;
      name: string;
      advertiserId: string;
      currency: string;
      budgetTotalMinor: bigint;
      budgetSpentMinor: bigint;
      budgetReservedMinor: bigint;
    },
    balanceMap: Map<string, bigint>,
  ): 'budget_exhausted' | 'advertiser_balance_depleted' | null {
    // Treat committed + reserved as committed for pause purposes. A campaign
    // whose remaining budget is entirely tied up in in-flight reservations has
    // no spendable budget left and should stop being selected by requestAd.
    if (campaign.budgetSpentMinor + campaign.budgetReservedMinor >= campaign.budgetTotalMinor) {
      return 'budget_exhausted';
    }
    const balance = balanceMap.get(`${campaign.advertiserId}:${campaign.currency}`) ?? 0n;
    if (balance <= 0n) {
      return 'advertiser_balance_depleted';
    }
    return null;
  }

  private async pauseCampaign(
    campaign: {
      id: string;
      name: string;
      advertiserId: string;
      currency: string;
      budgetTotalMinor: bigint;
      budgetSpentMinor: bigint;
    },
    reason: 'budget_exhausted' | 'advertiser_balance_depleted',
  ): Promise<boolean> {
    try {
      const result = await this.prisma.campaign.updateMany({
        where: { id: campaign.id, status: 'active' },
        data: { status: 'paused', pausedAt: new Date() },
      });
      if (result.count === 0) {
        return false;
      }
      this.logger.log(
        `Paused campaign ${campaign.id} (${campaign.name}): ${reason}. Spent ${campaign.budgetSpentMinor}/${campaign.budgetTotalMinor} ${campaign.currency}.`,
      );
      void this.audit.log({
        actorId: 'system',
        actorRole: 'system',
        action: 'auto_pause_campaign',
        targetType: 'campaign',
        targetId: campaign.id,
        afterSnap: {
          reason,
          budgetTotalMinor: String(campaign.budgetTotalMinor),
          budgetSpentMinor: String(campaign.budgetSpentMinor),
          currency: campaign.currency,
        },
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to auto-pause campaign ${campaign.id}: ${msg}`);
      return false;
    }
  }
}
