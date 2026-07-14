import { Module } from '@nestjs/common';

import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { CampaignReservationReclaimCron } from './campaign-reservation-reclaim.cron';
import { CampaignSpendGuardCron } from './campaign-spend-guard.cron';

@Module({
  imports: [RuntimeConfigModule],
  controllers: [CampaignController],
  providers: [CampaignService, CampaignSpendGuardCron, CampaignReservationReclaimCron],
  exports: [CampaignService],
})
export class CampaignModule {}
