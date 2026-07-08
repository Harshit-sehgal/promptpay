import { Module } from '@nestjs/common';

import { CampaignModule } from '../campaign/campaign.module';
import { PayoutModule } from '../payout/payout.module';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserService } from './advertiser.service';

@Module({
  imports: [PayoutModule, CampaignModule],
  controllers: [AdvertiserController],
  providers: [AdvertiserService],
})
export class AdvertiserModule {}
