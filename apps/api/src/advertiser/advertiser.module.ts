import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CampaignModule } from '../campaign/campaign.module';
import { PayoutModule } from '../payout/payout.module';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserService } from './advertiser.service';

@Module({
  imports: [PayoutModule, CampaignModule, AuthModule, RuntimeConfigModule],
  controllers: [AdvertiserController],
  providers: [AdvertiserService],
})
export class AdvertiserModule {}
