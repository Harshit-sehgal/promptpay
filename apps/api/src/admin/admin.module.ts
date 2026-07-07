import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PayoutModule } from '../payout/payout.module';
import { FraudModule } from '../fraud/fraud.module';
import { DeveloperModule } from '../developer/developer.module';

@Module({
  imports: [PayoutModule, FraudModule, DeveloperModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
