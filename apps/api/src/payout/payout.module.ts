import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutCronService } from './payout-cron.service';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';
import { PayPalPayoutsProvider, StripeProvider, StripeConnectPayoutProvider, WisePayoutProvider } from './providers';
import { StripeWebhookController } from './stripe-webhook.controller';
import { EventBus } from '../common/events/event-bus';

@Module({
  imports: [LedgerModule, ReferralModule],
  controllers: [PayoutController, StripeWebhookController],
  providers: [PayoutService, PayoutCronService, PayPalPayoutsProvider, StripeProvider, StripeConnectPayoutProvider, WisePayoutProvider, EventBus],
  exports: [PayoutService, StripeProvider, EventBus],
})
export class PayoutModule {}
