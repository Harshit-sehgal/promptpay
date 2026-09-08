import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { DeveloperModule } from '../developer/developer.module';
import { EmailModule } from '../email/email.module';
import { FraudModule } from '../fraud/fraud.module';
import { PayoutModule } from '../payout/payout.module';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MoneyIntegrityCronService } from './money-integrity.cron';

@Module({
  imports: [
    EmailModule,
    PayoutModule,
    FraudModule,
    DeveloperModule,
    RuntimeConfigModule,
    AgentModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, MoneyIntegrityCronService],
})
export class AdminModule {}
