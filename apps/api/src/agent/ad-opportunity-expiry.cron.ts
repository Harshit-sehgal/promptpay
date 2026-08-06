import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { acquireCronLease } from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';

const DEFAULT_INTERVAL_MS = 60 * 1000;
const MIN_INTERVAL_MS = 30 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;

export type AdOpportunityExpiryResult = { acquired: boolean; expired: number };

/** Marks unclaimed opportunity projections expired; it never creates ads or financial rows. */
@Injectable()
export class AdOpportunityExpiryCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AdOpportunityExpiryCron.name);
  private readonly ownerId = `ad-opportunity-expiry:${process.pid}`;
  private readonly intervalMs = clampInterval(process.env.AD_OPPORTUNITY_EXPIRY_INTERVAL_MS);
  private intervalId?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (!backgroundJobsEnabled()) return;
    void this.tick();
    this.intervalId = setInterval(() => void this.tick(), this.intervalMs);
    this.intervalId.unref?.();
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async tick(): Promise<AdOpportunityExpiryResult> {
    if (this.running) return { acquired: false, expired: 0 };
    this.running = true;
    try {
      const acquired = await acquireCronLease(
        this.prisma,
        'ad-opportunity-expiry',
        this.ownerId,
        Math.max(this.intervalMs * 2, 60_000),
      );
      if (!acquired) return { acquired: false, expired: 0 };
      const result = await this.prisma.adOpportunity.updateMany({
        where: { state: 'candidate', expiresAt: { lte: new Date() } },
        data: { state: 'expired', rejectionReason: 'opportunity_expired' },
      });
      if (result.count)
        this.logger.log(`Expired ${result.count} stale ad opportunity projection(s).`);
      return { acquired: true, expired: result.count };
    } catch (error) {
      this.logger.error(
        'Ad opportunity expiry failed',
        error instanceof Error ? error.stack : String(error),
      );
      return { acquired: false, expired: 0 };
    } finally {
      this.running = false;
    }
  }
}

function clampInterval(raw: string | undefined) {
  const parsed = raw === undefined ? DEFAULT_INTERVAL_MS : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.min(Math.max(Math.trunc(parsed), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
}
