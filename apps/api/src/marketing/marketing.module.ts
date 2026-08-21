import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { WaitlistAdminController } from './waitlist-admin.controller';

@Module({
  imports: [AuditModule],
  controllers: [WaitlistController, WaitlistAdminController],
  providers: [WaitlistService],
})
export class MarketingModule {}
