import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Stripe Connect payout provider.
 *
 * Flow:
 *  1. Advertiser adds a payment method via Stripe Checkout Session.
 *  2. For developer payouts, the platform transfers funds to a connected account
 *     (or uses platform balance for manual payouts).
 *
 * For MVP, we use Stripe for **advertiser deposits** (creating Checkout Sessions)
 * and simple **payout tracking** (recording external payout via Stripe Balance).
 * Full Connect onboarding for developers is a post-MVP enhancement.
 */
@Injectable()
export class StripeProvider {
  private readonly logger = new Logger(StripeProvider.name);
  private readonly stripe: Stripe | null;
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.enabled = !!secretKey;
    this.stripe = secretKey ? new Stripe(secretKey, { apiVersion: '2025-06-30.basil' as any }) : null;
  }

  /** Whether Stripe is configured */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Create a Stripe Checkout Session for an advertiser to deposit funds.
   * Returns the session URL the frontend should redirect to.
   */
  async createDepositSession(params: {
    advertiserId: string;
    amountMinor: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ sessionId: string; url: string }> {
    if (!this.stripe) throw new Error('Stripe is not configured');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: {
              name: 'WaitLayer Ad Credit Deposit',
              description: `Deposit for advertiser ${params.advertiserId}`,
            },
            unit_amount: params.amountMinor,
          },
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        advertiserId: params.advertiserId,
        ...params.metadata,
      },
    });

    return { sessionId: session.id, url: session.url! };
  }

  /**
   * Verify a Stripe webhook signature and return the parsed event.
   */
  verifyWebhookSignature(payload: string | Buffer, sig: string): Stripe.Event {
    if (!this.stripe) throw new Error('Stripe is not configured');
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    return this.stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  }

  /**
   * Process a completed or async-payment-succeeded checkout session.
   * Returns payment details including the Stripe customer ID for wiring.
   */
  async handleCheckoutComplete(sessionId: string): Promise<{
    advertiserId: string;
    amountMinor: number;
    currency: string;
    paymentIntentId: string;
    stripeCustomerId: string | null;
  }> {
    if (!this.stripe) throw new Error('Stripe is not configured');

    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const advertiserId = session.metadata?.advertiserId ?? '';
    const amountMinor = session.amount_total ?? 0;
    const currency = session.currency ?? 'usd';
    const paymentIntentId = session.payment_intent as string;
    const stripeCustomerId = (session.customer as string) ?? null;

    this.logger.log(`Checkout completed: advertiser=${advertiserId}, amount=${amountMinor}`);

    return { advertiserId, amountMinor, currency, paymentIntentId, stripeCustomerId };
  }

  /**
   * Retrieve details about a refunded charge for ledger reversal.
   */
  async getRefundDetails(refund: Stripe.Refund): Promise<{
    paymentIntentId: string;
    amountMinor: number;
    currency: string;
  }> {
    if (!this.stripe) throw new Error('Stripe is not configured');

    const paymentIntentId =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id ?? '';

    const amountMinor = refund.amount;
    const currency = refund.currency;

    this.logger.log(`Refund processed: paymentIntent=${paymentIntentId}, amount=${amountMinor}`);

    return { paymentIntentId, amountMinor, currency };
  }

  /**
   * Retrieve dispute details for fraud flagging.
   */
  async getDisputeDetails(dispute: Stripe.Dispute): Promise<{
    paymentIntentId: string;
    amountMinor: number;
    currency: string;
    reason: string;
    status: string;
  }> {
    if (!this.stripe) throw new Error('Stripe is not configured');

    const paymentIntentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? '';

    const amountMinor = dispute.amount;
    const currency = dispute.currency;
    const reason = dispute.reason ?? '';
    const status = dispute.status;

    this.logger.log(`Dispute created: paymentIntent=${paymentIntentId}, amount=${amountMinor}, reason=${reason}`);

    return { paymentIntentId, amountMinor, currency, reason, status };
  }
}
