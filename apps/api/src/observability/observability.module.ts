import { Global, Module } from '@nestjs/common';

import { AlertsService } from './alerts.service';
import { MetricsService } from './metrics.service';
import { ObservabilityController } from './observability.controller';

/**
 * Cross-cutting observability: operational metrics + alert dispatch.
 *
 * Declared @Global so MetricsService / AlertsService can be injected into any
 * cron or service (money-integrity, payout polling, audit) without per-module
 * import churn. Imported once in AppModule.
 */
@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [MetricsService, AlertsService],
  exports: [MetricsService, AlertsService],
})
export class ObservabilityModule {}
