import { Module } from '@nestjs/common';

import { AdOpportunityExpiryCron } from './ad-opportunity-expiry.cron';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentSessionReconciliationCron } from './agent-session-reconciliation.cron';
import { AgentShadowAggregationService } from './agent-shadow-aggregation.service';

@Module({
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentShadowAggregationService,
    AgentSessionReconciliationCron,
    AdOpportunityExpiryCron,
  ],
})
export class AgentModule {}
