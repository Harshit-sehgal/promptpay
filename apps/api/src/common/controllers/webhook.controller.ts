import { Controller, Post, Req, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { getErrorMessage, getErrorCode } from '../utils/errors';
import { StripeProvider } from '../../payout/providers';
import { PrismaService } from '../../config/prisma.service';
import type { Prisma } from '@waitlayer/db';

type RawBodyRequest = Request & { rawBody?: Buffer | string };

/**
 * Webhook controller for receiving Stripe events.
 *
 * This controller is intentionally NOT guarded by JWT — Stripe sends
 * webhook requests with its own signature that we verify manually.
 */
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private stripe: StripeProvider,
    private prisma: PrismaService,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(@Req() req: RawBodyRequest) {
    if (!this.stripe.isEnabled()) {
      this.logger.warn('Stripe webhook received but Stripe is not configured');
      return { received: false };
    }

    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      this.logger.warn('Stripe webhook missing signature header');
      return { received: false };
    }

    // Verify Stripe signature
    let event: Stripe.Event;
    try {
      const rawBody = req.rawBody ?? req.body;
      if (!rawBody) {
        this.logger.error('Stripe webhook missing raw body — raw-body middleware may not be configured');
        return { received: false };
      }
      event = this.stripe.verifyWebhookSignature(rawBody, sig);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Stripe webhook signature verification failed');
      this.logger.error(`Stripe webhook signature verification failed: ${message}`);
      return { received: false, reason: 'signature_verification_failed' };
    }

    // ── Idempotency: insert-or-detect-duplicate via webhookEvent table ──
    // Stripe retries webhooks; without dedup the same checkout.session.completed
    // can credit the advertiser ledger twice. The webhookEvent table with its
    // @@unique([provider, eventId]) constraint serves as the idempotency gate.
    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: event.id,
          eventType: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
          processingStatus: 'processed', // synchronous handler — no async reclamation needed
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        // Already processed — return 200 so Stripe stops retrying
        this.logger.log(`Duplicate Stripe webhook ${event.id} — already processed`);
        return { received: true };
      }
      this.logger.error(`Failed to persist webhook event ${event.id}: ${getErrorMessage(err)}`);
      throw err;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.handleCheckoutComplete(session.id);
        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        // ACH / SEPA / BACS payments settle async. The checkout session
        // transitions from 'pending' to 'complete' after funds clear.
        // The session_id is unchanged; handleCheckoutComplete uses it to
        // look up the advertiser and PaymentIntent — same logic as completed.
        const session = event.data.object as Stripe.Checkout.Session;
        this.logger.log(`Async payment succeeded for session ${session.id}`);
        await this.handleCheckoutComplete(session.id);
        break;
      }
      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return { received: true };
  }

  private async handleCheckoutComplete(sessionId: string) {
    const result = await this.stripe.handleCheckoutComplete(sessionId);

    // Find the advertiser and create an advertiser ledger credit entry
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: result.advertiserId },
    });
    if (!advertiser) {
      this.logger.error(`Advertiser ${result.advertiserId} not found for checkout ${sessionId}`);
      return;
    }

    // Record deposit in advertiser ledger. The idempotencyKey unique constraint
    // on advertiserLedger guards against duplicate credits from async_payment_succeeded
    // retries after the initial completed webhook was already processed.
    try {
      await this.prisma.advertiserLedger.create({
        data: {
          advertiserId: advertiser.id,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: result.amountMinor,
          currency: result.currency.toUpperCase(),
          stripePaymentIntentId: result.paymentIntentId,
          idempotencyKey: `stripe_deposit_${result.paymentIntentId}`,
          description: `Stripe deposit — session ${sessionId}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.log(`Duplicate advertiser ledger entry for PI ${result.paymentIntentId} — already credited`);
        return;
      }
      throw err;
    }

    this.logger.log(`Recorded Stripe deposit: ${result.amountMinor} ${result.currency} for advertiser ${advertiser.id}`);
  }
}
