import { Module } from '@nestjs/common';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentSessionReconciliationCron } from './agent-session-reconciliation.cron';

@Module({
  controllers: [AgentController],
  providers: [AgentService, AgentSessionReconciliationCron],
})
export class AgentModule {}
