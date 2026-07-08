import { Module } from '@nestjs/common';

import { DeveloperModule } from '../developer/developer.module';
import { FraudModule } from '../fraud/fraud.module';
import { PayoutModule } from '../payout/payout.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MoneyIntegrityCronService } from './money-integrity.cron';

@Module({
  imports: [PayoutModule, FraudModule, DeveloperModule],
  controllers: [AdminController],
  providers: [AdminService, MoneyIntegrityCronService],
})
export class AdminModule {}
