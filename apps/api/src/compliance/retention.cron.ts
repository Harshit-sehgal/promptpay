import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common';
import { ComplianceService } from './compliance.service';

/**
 * Data-retention cron.
 *
 * Periodically enforces the operator-tunable retention windows stored in
 * `data_retention_config` by purging aged rows from webhook_events,
 * audit_logs, and sessions. Runs once on bootstrap (after seeding defaults)
 * and every 24h thereafter. Purge logic is in ComplianceService.purge so it
 * can also be triggered on-demand (e.g. admin runbook).
 */
@Injectable()
export class RetentionCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RetentionCronService.name);
  private intervalId?: NodeJS.Timeout;
  private readonly POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

  constructor(private compliance: ComplianceService) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting data-retention cron...');
    await this.compliance.ensureRetentionDefaults().catch((err) => {
      this.logger.error(`Retention defaults seed failed: ${String(err)}`);
    });
    void this.run().catch((err) => this.logger.error(`Retention run failed: ${String(err)}`));
    this.intervalId = setInterval(() => {
      void this.run().catch((err) => this.logger.error(`Retention run failed: ${String(err)}`));
    }, this.POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Data-retention cron stopped.');
    }
  }

  async run() {
    await this.compliance.ensureRetentionDefaults();
    await this.compliance.runAllRetention();
  }
}
