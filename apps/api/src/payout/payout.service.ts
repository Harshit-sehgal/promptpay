import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import {
  ManualPayoutProvider,
  PayPalEmailPayoutProvider,
  StubPayoutProvider,
} from './payout.constants';
import { PayoutMethodTrait } from './payout-method.trait';
import { PayoutRequestTrait } from './payout-request.trait';
import { PayoutSummaryTrait } from './payout-summary.trait';
import {
  PayPalPayoutsProvider,
  StripeConnectPayoutProvider,
  WisePayoutProvider,
} from './providers';

@Injectable()
export class PayoutService {
  public readonly logger = new Logger(PayoutService.name);

  constructor(
    public prisma: PrismaService,
    public ledger: LedgerService,
    public referral: ReferralService,
    public audit: AuditService,
    public config: ConfigService,
    public paypalPayouts: PayPalPayoutsProvider,
    public stripeConnect: StripeConnectPayoutProvider,
    public wise: WisePayoutProvider,
  ) {
    this.providers = {
      manual: new ManualPayoutProvider(),
      paypal_email: new PayPalEmailPayoutProvider(),
      paypal_payouts: this.paypalPayouts,
      stripe_connect: this.stripeConnect,
      payoneer: new StubPayoutProvider('Payoneer', 'payoneer'),
      wise: this.wise,
      razorpay: new StubPayoutProvider('Razorpay', 'razorpay'),
    };
  }
}

export interface PayoutService extends PayoutMethodTrait, PayoutSummaryTrait, PayoutRequestTrait {}

for (const name of Object.getOwnPropertyNames(PayoutMethodTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    PayoutService.prototype,
    name,
    Object.getOwnPropertyDescriptor(PayoutMethodTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(PayoutSummaryTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    PayoutService.prototype,
    name,
    Object.getOwnPropertyDescriptor(PayoutSummaryTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(PayoutRequestTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    PayoutService.prototype,
    name,
    Object.getOwnPropertyDescriptor(PayoutRequestTrait.prototype, name) as PropertyDescriptor,
  );
}
export * from './payout.constants';
