import { Module } from '@nestjs/common';

import { EventBus } from '../common/events/event-bus';
import { FraudModule } from '../fraud/fraud.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { DepositProcessorService } from './deposit-processor';
import { DodoWebhookController } from './dodo-webhook.controller';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutCronService } from './payout-cron.service';
import {
  DodoProvider,
  PayPalPayoutsProvider,
  StripeConnectPayoutProvider,
  StripeProvider,
  WisePayoutProvider,
} from './providers';
import { StripeWebhookController } from './stripe-webhook.controller';
import { WebhookReclaimCronService } from './webhook-reclaim-cron.service';

@Module({
  imports: [LedgerModule, ReferralModule, RuntimeConfigModule, FraudModule],
  controllers: [PayoutController, StripeWebhookController, DodoWebhookController],
  providers: [
    PayoutService,
    PayoutCronService,
    WebhookReclaimCronService,
    DepositProcessorService,
    PayPalPayoutsProvider,
    StripeProvider,
    StripeConnectPayoutProvider,
    WisePayoutProvider,
    DodoProvider,
    EventBus,
  ],
  exports: [PayoutService, StripeProvider, DepositProcessorService, EventBus],
})
export class PayoutModule {}
