import { Module } from '@nestjs/common';

import { EventBus } from '../common/events/event-bus';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutCronService } from './payout-cron.service';
import { PayPalPayoutsProvider, StripeConnectPayoutProvider, StripeProvider, WisePayoutProvider } from './providers';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [LedgerModule, ReferralModule],
  controllers: [PayoutController, StripeWebhookController],
  providers: [PayoutService, PayoutCronService, PayPalPayoutsProvider, StripeProvider, StripeConnectPayoutProvider, WisePayoutProvider, EventBus],
  exports: [PayoutService, StripeProvider, EventBus],
})
export class PayoutModule {}
