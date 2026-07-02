import { Controller, Post, Req, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { FraudFlagStatus, FraudFlagType, FraudSeverity, Prisma } from '@waitlayer/db';
import { StripeProvider } from './providers';
import { PrismaService } from '../config/prisma.service';
import { getErrorCode, getErrorMessage } from '../common/utils/errors';

type RawBodyRequest = Request & { rawBody?: Buffer | string };

/**
 * Stripe webhook controller — receives Stripe events for payout/deposit lifecycle.
 *
 * Route: POST /payout/stripe/webhook
 *
 * This controller is intentionally unauthenticated — Stripe sends webhook
 * requests with its own signature header that we verify manually.
 *
 * Raw body parsing is configured in main.ts for this route so that
 * Stripe's signature verification works correctly.
 */
@Controller('payout/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeProvider,
    private readonly prisma: PrismaService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: RawBodyRequest) {
    if (!this.stripe.isEnabled()) {
      this.logger.warn('Stripe webhook received but Stripe is not configured');
      return { received: false, reason: 'stripe_not_configured' };
    }

    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      this.logger.warn('Stripe webhook missing signature header');
      return { received: false, reason: 'missing_signature' };
    }

    // Stripe requires the raw request body for signature verification.
    // rawBody is populated by the raw-body middleware configured in main.ts.
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Stripe webhook missing raw body — raw-body middleware may not be configured');
      return { received: false, reason: 'missing_raw_body' };
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.verifyWebhookSignature(rawBody, sig);
    } catch (err: unknown) {
      this.logger.error(`Stripe webhook signature verification failed: ${getErrorMessage(err)}`);
      return { received: false, reason: 'signature_verification_failed' };
    }

    // Log the webhook event to the database for audit/idempotency
    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: event.id,
          eventType: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
          processingStatus: 'pending',
        },
      });
    } catch (err: unknown) {
      // If the event ID is already recorded (unique constraint), it's a replay — skip
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(`Duplicate Stripe event ${event.id} — skipping`);
        return { received: true, reason: 'duplicate_event' };
      }
      this.logger.error(`Failed to persist webhook event ${event.id}: ${getErrorMessage(err)}`);
      // Continue processing even if logging fails — don't block Stripe
    }

    // Process the event asynchronously — return 200 to Stripe immediately
    this.processEvent(event).catch((err: unknown) => {
      this.logger.error(`Async processing failed for event ${event.id}: ${getErrorMessage(err)}`);
    });

    return { received: true };
  }

  /**
   * Process a Stripe event based on its type.
   * All ledger/fraud operations are handled here.
   */
  private async processEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        await this.handlePaymentSuccess(event);
        break;
      }
      case 'charge.refunded': {
        await this.handleRefund(event);
        break;
      }
      case 'charge.dispute.created': {
        await this.handleDispute(event);
        break;
      }
      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }
  }

  /** Record a deposit in the advertiser ledger and wire the Stripe customer ID */
  private async handlePaymentSuccess(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const sessionId = session.id;

    const result = await this.stripe.handleCheckoutComplete(sessionId);

    if (!result.advertiserId) {
      this.logger.error(`No advertiserId in session metadata for checkout ${sessionId}`);
      return;
    }

    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: result.advertiserId },
    });
    if (!advertiser) {
      this.logger.error(`Advertiser ${result.advertiserId} not found for checkout ${sessionId}`);
      return;
    }

    // Wire the Stripe customer ID to the Advertiser record
    if (result.stripeCustomerId && !advertiser.stripeCustomerId) {
      await this.prisma.advertiser.update({
        where: { id: advertiser.id },
        data: { stripeCustomerId: result.stripeCustomerId },
      });
      this.logger.log(
        `Wired stripeCustomerId=${result.stripeCustomerId} to advertiser ${advertiser.id}`,
      );
    }

    // Record deposit in advertiser ledger (credit) — idempotent by paymentIntentId
    const idempotencyKey = `stripe_deposit_${result.paymentIntentId}`;
    try {
      await this.prisma.advertiserLedger.create({
        data: {
          advertiserId: advertiser.id,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: result.amountMinor,
          currency: result.currency.toUpperCase(),
          stripePaymentIntentId: result.paymentIntentId,
          idempotencyKey,
          description: `Stripe deposit — session ${sessionId}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(`Duplicate deposit for paymentIntent ${result.paymentIntentId} — skipping`);
      } else {
        throw err;
      }
    }

    // Update webhook event as processed
    await this.prisma.webhookEvent.updateMany({
      where: { eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Recorded Stripe deposit: ${result.amountMinor} ${result.currency} for advertiser ${advertiser.id}`,
    );
  }

  /** Reverse advertiser ledger entries when a charge is refunded */
  private async handleRefund(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    const details = await this.stripe.getRefundDetails(refund);

    if (!details.paymentIntentId) {
      this.logger.warn(`Refund event ${event.id} has no payment_intent — cannot reverse`);
      return;
    }

    // Find all advertiser ledger entries tied to this payment intent that are not yet reversed
    const entries = await this.prisma.advertiserLedger.findMany({
      where: {
        stripePaymentIntentId: details.paymentIntentId,
        status: { notIn: ['reversed', 'void'] },
      },
    });

    if (entries.length === 0) {
      this.logger.warn(
        `No active ledger entries found for paymentIntent ${details.paymentIntentId} in refund ${event.id}`,
      );
      // Still mark as processed
      await this.prisma.webhookEvent.updateMany({
        where: { eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    const totalRefunded = details.amountMinor;

    // Create reversal entries for the refunded amount
    for (const entry of entries) {
      const reversalAmount = Math.min(entry.amountMinor, totalRefunded);
      if (reversalAmount <= 0) continue;

      const idempotencyKey = `stripe_refund_${details.paymentIntentId}_${refund.id}_${entry.id}`;
      try {
        await this.prisma.advertiserLedger.create({
          data: {
            advertiserId: entry.advertiserId,
            campaignId: entry.campaignId,
            stripePaymentIntentId: details.paymentIntentId,
            entryType: 'refund',
            status: 'confirmed',
            amountMinor: reversalAmount,
            currency: details.currency.toUpperCase(),
            idempotencyKey,
            description: `Refund for Stripe paymentIntent ${details.paymentIntentId} — refund ${refund.id}`,
          },
        });
      } catch (err: unknown) {
        if (getErrorCode(err) === 'P2002') {
          this.logger.warn(`Duplicate refund entry for ${idempotencyKey} — skipping`);
        } else {
          throw err;
        }
      }

      // Mark the original entry as reversed if fully reversed
      const totalReversed = await this.prisma.advertiserLedger.aggregate({
        where: {
          stripePaymentIntentId: details.paymentIntentId,
          entryType: 'refund',
        },
        _sum: { amountMinor: true },
      });
      if ((totalReversed._sum.amountMinor ?? 0) >= entry.amountMinor) {
        await this.prisma.advertiserLedger.update({
          where: { id: entry.id },
          data: { status: 'reversed' },
        });
      }
    }

    // Update webhook event as processed
    await this.prisma.webhookEvent.updateMany({
      where: { eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Refund processed: paymentIntent=${details.paymentIntentId}, amount=${totalRefunded} ${details.currency}`,
    );
  }

  /** Create a fraud flag when a dispute is filed against a charge */
  private async handleDispute(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const details = await this.stripe.getDisputeDetails(dispute);

    if (!details.paymentIntentId) {
      this.logger.warn(`Dispute event ${event.id} has no payment_intent — cannot flag`);
      return;
    }

    // Find the advertiser via the ledger entry that was credited for this payment intent
    const ledgerEntry = await this.prisma.advertiserLedger.findFirst({
      where: {
        stripePaymentIntentId: details.paymentIntentId,
        entryType: 'credit',
      },
      include: { advertiser: true },
    });

    if (!ledgerEntry) {
      this.logger.warn(
        `No credit entry found for paymentIntent ${details.paymentIntentId} in dispute ${event.id}`,
      );
      await this.prisma.webhookEvent.updateMany({
        where: { eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    const advertiserId = ledgerEntry.advertiserId;
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: advertiserId },
      include: { user: true },
    });
    if (!advertiser) {
      this.logger.warn(`Advertiser ${advertiserId} not found for dispute ${event.id}`);
      return;
    }

    // Create a fraud flag for review
    try {
      await this.prisma.fraudFlag.create({
        data: {
          userId: advertiser.userId,
          flagType: FraudFlagType.shared_payout_destination,
          severity: details.status === 'lost' ? FraudSeverity.critical : FraudSeverity.high,
          status: FraudFlagStatus.open,
          evidence: {
            source: 'stripe_webhook',
            stripeDisputeId: dispute.id,
            paymentIntentId: details.paymentIntentId,
            amountMinor: details.amountMinor,
            currency: details.currency,
            reason: details.reason,
            disputeStatus: details.status,
            webhookEventId: event.id,
          },
          reviewNote: `Stripe dispute created: ${details.reason} — ${details.amountMinor} ${details.currency}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(`Duplicate dispute flag for ${dispute.id} — skipping`);
      } else {
        this.logger.error(`Failed to create fraud flag for dispute ${dispute.id}: ${getErrorMessage(err)}`);
      }
    }

    // Update webhook event as processed
    await this.prisma.webhookEvent.updateMany({
      where: { eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Dispute flagged: paymentIntent=${details.paymentIntentId}, advertiser=${advertiserId}, reason=${details.reason}`,
    );
  }
}
