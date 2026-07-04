import { Module } from '@nestjs/common';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserService } from './advertiser.service';
import { PayoutModule } from '../payout/payout.module';
import { CampaignModule } from '../campaign/campaign.module';

@Module({
  imports: [PayoutModule, CampaignModule],
  controllers: [AdvertiserController],
  providers: [AdvertiserService],
})
export class AdvertiserModule {}
