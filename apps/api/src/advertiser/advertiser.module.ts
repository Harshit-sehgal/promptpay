import { Module } from '@nestjs/common';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserService } from './advertiser.service';
import { PayoutModule } from '../payout/payout.module';
import { CampaignModule } from '../campaign/campaign.module';
import { WebhookController } from '../common/controllers/webhook.controller';

@Module({
  imports: [PayoutModule, CampaignModule],
  controllers: [AdvertiserController, WebhookController],
  providers: [AdvertiserService],
})
export class AdvertiserModule {}
