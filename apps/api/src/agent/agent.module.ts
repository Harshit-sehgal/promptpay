import { Module } from '@nestjs/common';

import { AdOpportunityExpiryCron } from './ad-opportunity-expiry.cron';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentSessionReconciliationCron } from './agent-session-reconciliation.cron';
import { AgentShadowAggregationService } from './agent-shadow-aggregation.service';
import { AttentionExperimentService } from './attention-experiment.service';
import { AttentionModelArtifactService } from './attention-model-artifact.service';
import { AttentionPolicyService } from './attention-policy.service';
import { AttentionShadowAdminService } from './attention-shadow-admin.service';
import { AttentionShadowFactCron } from './attention-shadow-fact.cron';
import { AttentionShadowFactService } from './attention-shadow-fact.service';
import { AttentionShadowOutcomeService } from './attention-shadow-outcome.service';

@Module({
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentShadowAggregationService,
    AttentionShadowFactService,
    AttentionShadowFactCron,
    AttentionExperimentService,
    AttentionModelArtifactService,
    AttentionShadowOutcomeService,
    AttentionShadowAdminService,
    AttentionPolicyService,
    AgentSessionReconciliationCron,
    AdOpportunityExpiryCron,
  ],
  exports: [AttentionShadowAdminService],
})
export class AgentModule {}
