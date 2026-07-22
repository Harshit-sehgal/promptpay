import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { acquireCronLease, renewCronLease } from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from './ledger.service';

@Injectable()
export class LedgerCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LedgerCronService.name);
  private intervalId?: NodeJS.Timeout;
  private running = false;
  private readonly ownerId = randomUUID();
  private readonly intervalMs = Math.min(
    Math.max(Number(process.env.LEDGER_MATURATION_INTERVAL_MS) || 600_000, 10_000),
    86_400_000,
  );
  // A maturation batch may legitimately outlive its scheduling interval on a
  // large ledger. Keep its cross-replica lease alive while it runs instead of
  // letting another replica start the same job after intervalMs - 1s.
  private readonly leaseTtlMs = Math.max(this.intervalMs * 2, 60_000);

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    if (!backgroundJobsEnabled()) return;
    this.logger.log('Starting earnings maturation cron service...');
    // Startup must not block application readiness.
    void this.runMaturation().catch((error: unknown) => {
      this.logger.error('Startup earnings maturation failed', error);
    });

    // Check every 10 minutes by default; configurable via
    // LEDGER_MATURATION_INTERVAL_MS.
    this.intervalId = setInterval(() => {
      void this.runMaturation();
    }, this.intervalMs);
  }

  private async runMaturation() {
    if (this.running) {
      this.logger.warn('Earnings maturation already in flight — skipping overlapping run');
      return;
    }
    this.running = true;
    try {
      if (
        !(await acquireCronLease(this.prisma, 'ledger-maturation', this.ownerId, this.leaseTtlMs))
      ) {
        return;
      }
      const heartbeat = setInterval(
        () => {
          void renewCronLease(this.prisma, 'ledger-maturation', this.ownerId, this.leaseTtlMs).then(
            (renewed) => {
              if (!renewed) {
                this.logger.error('Lost earnings-maturation lease; another replica may take over');
              }
            },
            (error: unknown) =>
              this.logger.error('Failed to renew earnings-maturation lease', error),
          );
        },
        Math.max(Math.floor(this.leaseTtlMs / 3), 10_000),
      );
      heartbeat.unref?.();
      this.logger.log('Running estimated earnings maturation...');
      try {
        const result = await this.ledgerService.matureEarnings();
        if (result.matured > 0) {
          this.logger.log(`Successfully matured ${result.matured} earnings entries.`);
        }
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      this.logger.error('Failed to mature estimated earnings:', error);
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Earnings maturation cron service stopped.');
    }
  }
}
