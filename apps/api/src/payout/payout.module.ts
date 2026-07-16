import { Module } from '@nestjs/common';

import { EventBus } from '../common/events/event-bus';
import { FraudModule } from '../fraud/fraud.module';
import { WebhookReclaimCronService } from '../integration/webhook-reclaim-cron.service';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutCronService } from './payout-cron.service';
import {
  PayPalPayoutsProvider,
  StripeConnectPayoutProvider,
  StripeProvider,
  WisePayoutProvider,
} from './providers';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [LedgerModule, ReferralModule, RuntimeConfigModule, FraudModule],
  controllers: [PayoutController, StripeWebhookController],
  providers: [
    PayoutService,
    PayoutCronService,
    WebhookReclaimCronService,
    PayPalPayoutsProvider,
    StripeProvider,
    StripeConnectPayoutProvider,
    WisePayoutProvider,
    EventBus,
  ],
  exports: [PayoutService, StripeProvider, EventBus],
})
export class PayoutModule {}
