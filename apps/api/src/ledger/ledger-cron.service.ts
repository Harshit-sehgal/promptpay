import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common';
import { LedgerService } from './ledger.service';

@Injectable()
export class LedgerCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LedgerCronService.name);
  private intervalId?: NodeJS.Timeout;

  constructor(private readonly ledgerService: LedgerService) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting earnings maturation cron service...');
    // Run immediately on startup
    await this.runMaturation();

    // Check every 10 minutes (600,000 ms)
    const intervalMs = 600000;
    this.intervalId = setInterval(() => {
      this.runMaturation();
    }, intervalMs);
  }

  private async runMaturation() {
    try {
      this.logger.log('Running estimated earnings maturation...');
      const result = await this.ledgerService.matureEarnings();
      if (result.matured > 0) {
        this.logger.log(`Successfully matured ${result.matured} earnings entries.`);
      }
    } catch (error) {
      this.logger.error('Failed to mature estimated earnings:', error);
    }
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Earnings maturation cron service stopped.');
    }
  }
}
