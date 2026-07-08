import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MoneyIntegrityCronService } from './money-integrity.cron';
import { PayoutModule } from '../payout/payout.module';
import { FraudModule } from '../fraud/fraud.module';
import { DeveloperModule } from '../developer/developer.module';

@Module({
  imports: [PayoutModule, FraudModule, DeveloperModule],
  controllers: [AdminController],
  providers: [AdminService, MoneyIntegrityCronService],
})
export class AdminModule {}
