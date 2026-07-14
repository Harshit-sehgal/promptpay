import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { acquireCronLease } from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';

/**
 * Reclaims campaign budget reserved by impressions that were served but
 * never qualified (e.g., user closed the browser, device went offline, or
 * the impression failed validation). Without this cleanup, reserved budget
 * would remain locked indefinitely.
 *
 * The cron runs periodically (default 10 minutes), scans for impressions
 * older than a configurable threshold that have not qualified, releases the
 * reservation on the parent campaign, and marks the impression as
 * invalidated. A cross-replica cron lease ensures only one API instance
 * performs the scan.
 */
@Injectable()
export class CampaignReservationReclaimCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CampaignReservationReclaimCron.name);
  private readonly ownerId = randomUUID();
  private intervalId?: NodeJS.Timeout;
  private running = false;

  private readonly INTERVAL_MS = Math.min(
    Math.max(Number(process.env.CAMPAIGN_RESERVATION_RECLAIM_INTERVAL_MS) || 600_000, 60_000),
    3_600_000,
  );

  // Impressions that have not qualified within this window are considered
  // abandoned and their reservation is released. Default: 2 hours.
  private readonly STALE_THRESHOLD_MS = Math.min(
    Math.max(
      Number(process.env.CAMPAIGN_RESERVATION_STALE_MS) || 2 * 60 * 60 * 1000,
      60 * 60 * 1000,
    ),
    24 * 60 * 60 * 1000,
  );

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    this.logger.log('Starting campaign reservation reclaim cron...');
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Campaign reservation reclaim cron stopped.');
    }
  }

  async tick(): Promise<{ reclaimed: number; scanned: number }> {
    if (this.running) {
      this.logger.warn('Campaign reservation reclaim already running — skipping overlapping run');
      return { reclaimed: 0, scanned: 0 };
    }
    this.running = true;
    try {
      if (
        !(await acquireCronLease(
          this.prisma,
          'campaign-reservation-reclaim',
          this.ownerId,
          this.INTERVAL_MS - 1_000,
        ))
      ) {
        return { reclaimed: 0, scanned: 0 };
      }

      const cutoff = new Date(Date.now() - this.STALE_THRESHOLD_MS);

      // Find CPM impressions that were served but never qualified. We only
      // need campaigns that are still active or paused (reservations on
      // archived campaigns are still worth reclaiming).
      const staleImpressions = await this.prisma.adImpression.findMany({
        where: {
          qualifiedAt: null,
          invalidatedAt: null,
          createdAt: { lt: cutoff },
          campaign: { bidType: 'cpm' },
        },
        select: {
          id: true,
          campaignId: true,
          campaign: {
            select: {
              bidAmountMinor: true,
              budgetReservedMinor: true,
            },
          },
        },
        take: 500,
      });

      let reclaimed = 0;
      for (const impression of staleImpressions) {
        const bid = BigInt(impression.campaign.bidAmountMinor);
        if (bid <= 0n) continue;

        try {
          const didReclaim = await this.prisma.$transaction(async (tx) => {
            // Re-validate the impression is still unqualified and uninvalidated
            // inside the transaction to avoid double-reclaim races.
            const current = await tx.adImpression.findUnique({
              where: { id: impression.id },
              select: { qualifiedAt: true, invalidatedAt: true },
            });
            if (!current || current.qualifiedAt || current.invalidatedAt) {
              return false;
            }

            // Release the reservation. The WHERE guard prevents the reserved
            // budget from going negative if another path already released it.
            await tx.$executeRaw`
              UPDATE "campaigns"
              SET "budgetReservedMinor" = "budgetReservedMinor" - ${bid}
              WHERE "id" = ${impression.campaignId}
                AND "budgetReservedMinor" >= ${bid}
            `;

            await tx.adImpression.update({
              where: { id: impression.id },
              data: {
                invalidatedAt: new Date(),
                invalidationReason: 'stale_reservation',
                isBillable: false,
              },
            });
            return true;
          });
          if (didReclaim) reclaimed++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Failed to reclaim reservation for impression ${impression.id}: ${msg}`,
          );
        }
      }

      if (reclaimed > 0) {
        this.logger.log(`Campaign reservation reclaim released ${reclaimed} stale reservation(s).`);
      }
      return { reclaimed, scanned: staleImpressions.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Campaign reservation reclaim failed: ${msg}`);
      return { reclaimed: 0, scanned: 0 };
    } finally {
      this.running = false;
    }
  }
}
