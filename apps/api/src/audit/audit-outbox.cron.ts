import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { acquireCronLease } from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from './audit.service';

/**
 * Background worker that drains the durable audit outbox.
 *
 * - Runs every 30 seconds via setInterval.
 * - Acquires a cross-replica cron lease.
 * - Delegates to AuditService.processOutbox for the actual drain.
 * - Failed rows are updated with exponential backoff and retried later.
 */
@Injectable()
export class AuditOutboxCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuditOutboxCron.name);
  private readonly nodeId = randomUUID();
  private intervalId?: NodeJS.Timeout;

  private readonly LEASE_TTL_MS = 55_000;
  private readonly INTERVAL_MS = 30_000;

  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Starting audit outbox drain cron...');

    // Fire-and-forget startup run, then poll every 30 seconds.
    void this.drain().catch((err: unknown) => {
      this.logger.error(`Audit outbox startup drain failed: ${this.formatError(err)}`);
    });

    this.intervalId = setInterval(() => {
      void this.drain().catch((err: unknown) => {
        this.logger.error(`Audit outbox drain failed: ${this.formatError(err)}`);
      });
    }, this.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Audit outbox drain cron stopped.');
    }
  }

  private async drain(): Promise<void> {
    if (
      !(await acquireCronLease(this.prisma, 'audit-outbox-drain', this.nodeId, this.LEASE_TTL_MS))
    ) {
      return;
    }

    const processed = await this.audit.processOutbox();
    if (processed > 0) {
      this.logger.log(`Audit outbox drained: ${processed} row(s) processed`);
    }
  }

  private formatError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
