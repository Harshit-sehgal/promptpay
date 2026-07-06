import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';
import { PayPalPayoutsProvider, StripeProvider, StripeConnectPayoutProvider } from './providers';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [LedgerModule, ReferralModule],
  controllers: [PayoutController, StripeWebhookController],
  providers: [PayoutService, PayPalPayoutsProvider, StripeProvider, StripeConnectPayoutProvider],
  exports: [PayoutService, StripeProvider],
})
export class PayoutModule {}
