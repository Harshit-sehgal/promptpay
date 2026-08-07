import { Module } from '@nestjs/common';

import { AdOpportunityExpiryCron } from './ad-opportunity-expiry.cron';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentSessionReconciliationCron } from './agent-session-reconciliation.cron';

@Module({
  controllers: [AgentController],
  providers: [AgentService, AgentSessionReconciliationCron, AdOpportunityExpiryCron],
})
export class AgentModule {}
