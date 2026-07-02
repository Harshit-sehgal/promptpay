import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PayoutModule } from '../payout/payout.module';

@Module({
  imports: [PayoutModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
