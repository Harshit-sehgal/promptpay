import Stripe from 'stripe';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { privacyPseudonym } from '../../common/utils/privacy-hash';
import {
  requireProviderSafeMinorAmount,
  STRIPE_MAX_MINOR_AMOUNT,
} from '../../common/utils/provider-amount';
import type { PayoutProviderHandler } from '../payout.service';
import { PayoutProviderUnsafeFailure } from '../payout-provider.errors';

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
    this.stripe = secretKey ? new Stripe(secretKey, { apiVersion: '2026-06-24.dahlia' }) : null;
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
    amountMinor: bigint;
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
            unit_amount: Number(
              requireProviderSafeMinorAmount(
                params.amountMinor,
                'Stripe Checkout',
                STRIPE_MAX_MINOR_AMOUNT,
              ),
            ),
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
    // Fail closed: if Stripe is enabled but the webhook secret is empty,
    // the Stripe SDK's `constructEvent` would reject every event's
    // signature with a generic error — silently breaking deposit/refund/
    // dispute processing. Surface a clear, configuration-named error so
    // the operator sees the missing secret rather than debugging mysterious
    // signature failures on every legitimate webhook.
    if (!webhookSecret) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is not configured — Stripe webhooks cannot be verified. Set it alongside STRIPE_SECRET_KEY before accepting webhook traffic.',
      );
    }
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
        : (refund.payment_intent?.id ?? '');

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
        : (dispute.payment_intent?.id ?? '');

    const amountMinor = dispute.amount;
    const currency = dispute.currency;
    const reason = dispute.reason ?? '';
    const status = dispute.status;

    this.logger.log(
      `Dispute created: paymentIntent=${paymentIntentId}, amount=${amountMinor}, reason=${reason}`,
    );

    return { paymentIntentId, amountMinor, currency, reason, status };
  }
}

/**
 * Stripe Connect payout provider (developer → connected account).
 *
 * Replaces the former `StubPayoutProvider('Stripe Connect', ...)` placeholder.
 * When a developer adds a `stripe_connect` payout method, the `destination`
 * field stores their Stripe **connected account id** (e.g. `acct_1AbC...`).
 * On `initiate()` we first transfer platform funds to the connected account,
 * then call Stripe Connect's `payouts.create` *on the connected account*
 * (`stripeAccount` header) to push funds from that account's balance to the
 * developer's bank account. The returned Stripe Payout id is recorded as
 * `providerTxId` and the `payout.paid` / `payout.failed` webhooks reconcile
 * the `PayoutRequest` to a terminal state.
 *
 * Production readiness:
 *  - `STRIPE_SECRET_KEY` must be set (no-op provider otherwise).
 *  - The developer's connected account id must be a non-empty `acct_*` string;
 *    an empty/malformed destination fails closed so we never move production
 *    money to an unknown account.
 *  - In `NODE_ENV=production` the provider refuses to run if Stripe is not
 *    configured, matching the fail-closed posture of the other automated PSPs.
 */
@Injectable()
export class StripeConnectPayoutProvider implements PayoutProviderHandler {
  private readonly logger = new Logger(StripeConnectPayoutProvider.name);
  private readonly stripe: Stripe | null;
  private readonly enabled: boolean;
  private readonly nodeEnv: string;

  constructor(private config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.enabled = !!secretKey;
    this.nodeEnv = this.config.get<string>('NODE_ENV', process.env.NODE_ENV || 'development');
    this.stripe = secretKey ? new Stripe(secretKey, { apiVersion: '2026-06-24.dahlia' }) : null;
  }

  readiness(): { ok: true } | { ok: false; reason: string } {
    if (!this.enabled) {
      if (this.nodeEnv === 'production') {
        return {
          ok: false,
          reason:
            'Stripe Connect payouts are not configured: set STRIPE_SECRET_KEY to enable developer payouts via Stripe Connect.',
        };
      }
      return {
        ok: false,
        reason: 'Stripe Connect payout provider is disabled (no STRIPE_SECRET_KEY).',
      };
    }
    return { ok: true };
  }

  async initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }> {
    if (!this.stripe) {
      throw new Error(
        'Stripe Connect payout provider is not configured (STRIPE_SECRET_KEY missing).',
      );
    }

    const connectedAccount = params.destination?.trim();
    if (!connectedAccount || !connectedAccount.startsWith('acct_')) {
      throw new Error(
        'Invalid Stripe Connect destination: a developer payout method must store a connected account id (acct_...).',
      );
    }

    // Stripe expects integer minor units (cents) and a lowercase currency code.
    const amount = Number(
      requireProviderSafeMinorAmount(params.amountMinor, 'Stripe Connect', STRIPE_MAX_MINOR_AMOUNT),
    );

    const transferGroup = `wl_payout_${params.payoutRequestId}`;
    const transfer = await this.stripe.transfers.create(
      {
        amount,
        currency: params.currency.toLowerCase(),
        destination: connectedAccount,
        transfer_group: transferGroup,
        metadata: {
          payoutRequestId: params.payoutRequestId,
          provider: 'stripe_connect',
          purpose: 'developer_payout_funding',
        },
      },
      { idempotencyKey: `${transferGroup}_transfer` },
    );

    let payout: Stripe.Payout;
    try {
      payout = await this.stripe.payouts.create(
        {
          amount,
          currency: params.currency.toLowerCase(),
          metadata: {
            payoutRequestId: params.payoutRequestId,
            provider: 'stripe_connect',
            transferId: transfer.id,
          },
        },
        {
          stripeAccount: connectedAccount,
          idempotencyKey: `${transferGroup}_payout`,
        },
      );
    } catch {
      try {
        await this.stripe.transfers.createReversal(
          transfer.id,
          {
            amount,
            metadata: {
              payoutRequestId: params.payoutRequestId,
              provider: 'stripe_connect',
              reason: 'connected_account_payout_create_failed',
            },
          },
          { idempotencyKey: `${transferGroup}_transfer_reversal` },
        );
      } catch {
        throw new PayoutProviderUnsafeFailure(
          `Stripe Connect payout creation failed after transfer ${transfer.id}, and automatic transfer reversal failed. ` +
            'Do not release payout allocations until Stripe is reconciled manually.',
        );
      }

      throw new Error(
        `Stripe Connect payout creation failed after transfer ${transfer.id}; transfer was reversed.`,
      );
    }

    const accountRef = privacyPseudonym(
      connectedAccount,
      'stripe-connect-payout-destination',
    ).slice(0, 12);
    this.logger.log(
      `Stripe Connect payout initiated: request=${params.payoutRequestId}, accountRef=${accountRef}, amount=${amount} ${params.currency}, stripeTransfer=${transfer.id}, stripePayout=${payout.id}`,
    );

    return { providerTxId: payout.id, status: payout.status ?? 'pending' };
  }

  async checkStatus(
    providerTxId: string,
    context?: { destination?: string },
  ): Promise<{ status: string; paidAt?: Date }> {
    if (!this.stripe) {
      throw new Error(
        'Stripe Connect payout provider is not configured (STRIPE_SECRET_KEY missing).',
      );
    }
    const connectedAccount = context?.destination?.trim();
    if (!connectedAccount || !connectedAccount.startsWith('acct_')) {
      throw new Error(
        'Invalid Stripe Connect status destination: a connected account id (acct_...) is required.',
      );
    }
    const payout = await this.stripe.payouts.retrieve(
      providerTxId,
      {},
      { stripeAccount: connectedAccount },
    );
    const status =
      payout.status === 'paid'
        ? 'paid'
        : payout.status === 'failed' || payout.status === 'canceled'
          ? 'requires_review'
          : 'processing';
    return {
      status,
      paidAt: payout.arrival_date ? new Date(payout.arrival_date * 1000) : undefined,
    };
  }
}
