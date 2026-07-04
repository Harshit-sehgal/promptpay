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

    // ── Idempotency: insert-or-detect-replay then atomic claim ──
    //
    // 1. New event        → insert row (status='pending') → atomic claim
    //                        (updateMany pending→processing) → process.
    // 2. Retry / past processed → insert P2002 → read existing row:
    //    - status='processed' → return immediately.
    //    - status='processing' & stall timeout expired → reclaim & reprocess.
    //    - status='processing' & recent → skip (concurrent processor active).
    //    - status='pending' → claim now.
    //
    // We process synchronously inside the request (rather than fire-and-forget)
    // so that a crash leaves the row in 'processing' instead of 'pending'
    // (which could never be reclaimed). Stripe's retry interval is long enough
    // (minutes→hours) that the sync latency is unnoticeable to the stripe
    // event-sender.
    const PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

    // 1. Insert or detect replay
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
      if (getErrorCode(err) !== 'P2002') {
        this.logger.error(`Failed to persist webhook event ${event.id}: ${getErrorMessage(err)}`);
        throw err;
      }
    }

    // 2. Read existing row (fresh or replay) and decide action.
    //    Uniqueness is scoped by [provider, eventId] (see schema); the
    //    composite key is the authoritative idempotency floor.
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
    });
    if (!existing) {
      this.logger.error(`Webhook event ${event.id} vanished after insert — aborting`);
      return { received: false, reason: 'persistence_race' };
    }

    if (existing.processingStatus === 'processed') {
      return { received: true, reason: 'already_processed' };
    }

    if (existing.processingStatus === 'processing') {
      const claimedAt = existing.processedAt; // populated at claim time as the processing-start marker
      const stalledMs = claimedAt ? Date.now() - claimedAt.getTime() : 0;
      if (stalledMs < PROCESSING_TIMEOUT_MS) {
        this.logger.warn(`Stripe event ${event.id} currently being processed by another worker`);
        return { received: true, reason: 'currently_processing' };
      }
      this.logger.warn(`Stripe event ${event.id} stalled in processing for ${Math.round(stalledMs / 1000)}s — reclaiming`);
    }

    // 3. Atomic claim: pending (or stalled processing) → processing.
    //    Scope by provider so the claim never touches another provider's row
    //    even if an id coincided across providers before the
    //    provider_eventId composite-unique migration.
    const claimed = await this.prisma.webhookEvent.updateMany({
      where: {
        provider: 'stripe',
        eventId: event.id,
        processingStatus: { in: ['pending', 'processing'] },
      },
      data: {
        processingStatus: 'processing',
        processedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      // Lost the claim race — another worker claimed it between read and update
      return { received: true, reason: 'claimed_by_other' };
    }

    // 4. Process event
    try {
      await this.processEvent(event);
    } catch (err: unknown) {
      this.logger.error(`Processing failed for Stripe event ${event.id}: ${getErrorMessage(err)}`);
      // Reset to 'pending' so the next retry can reclaim
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id, processingStatus: 'processing' },
        data: { processingStatus: 'pending' },
      });
      return { received: true, reason: 'processing_failed_will_retry' };
    }

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
      case 'refund.created': {
        // Use refund.created (data.object IS a Stripe.Refund), NOT
        // charge.refunded (whose data.object is a Stripe.Charge). The
        // previous handler cast the Charge as a Refund: refund.id was the
        // CHARGE id (so two partial refunds on the same charge collapsed to
        // the same idempotency key and the second was silently P2002-dropped),
        // and refund.amount was the full charge amount (so a $5 partial
        // refund on a $100 charge reversed $100 from the advertiser). Both
        // are money-loss bugs. refund.created is fired once per individual
        // refund with the specific Refund object — refund.id and refund.amount
        // are the per-refund values we need.
        await this.handleRefund(event);
        break;
      }
      case 'charge.dispute.created': {
        await this.handleDispute(event);
        break;
      }
      case 'charge.dispute.closed': {
        await this.handleDisputeClosed(event);
        break;
      }
      case 'charge.dispute.funds_withdrawn': {
        // Stripe posts funds_withdrawn_after the dispute is closed and the
        // disputed amount leaves our account. There is no further ledger
        // action: by the time we reach this event, the close handler has
        // already either released the hold (won) or written it off (lost).
        // We acknowledge receipt so the webhook_event row converges to
        // 'processed' instead of lingering as 'processing'.
        this.logger.log(`Dispute funds withdrawn for event ${event.id} — already settled at close, acknowledging`);
        await this.prisma.webhookEvent.updateMany({
          where: { provider: 'stripe', eventId: event.id },
          data: { processingStatus: 'processed', processedAt: new Date() },
        });
        break;
      }
      case 'payout.paid': {
        await this.handlePayoutPaid(event);
        break;
      }
      case 'payout.failed': {
        await this.handlePayoutFailed(event);
        break;
      }
      default:
        // Mark unhandled events as processed so the webhook_event row
        // converges to a terminal state instead of stuck in 'processing'
        // (which the 30-min stall-reclaim would otherwise re-pull forever,
        // and Stripe would re-deliver on top of that). We deliberately do
        // NOT process the payload — just acknowledge receipt.
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
        await this.prisma.webhookEvent.updateMany({
          where: { provider: 'stripe', eventId: event.id },
          data: { processingStatus: 'processed', processedAt: new Date() },
        });
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

    // ── Platform-side cash double-entry ──
    // Pair the advertiser credit with a platform `cash` bucket credit so the
    // platform's books reflect the inbound cash from Stripe. Idempotent by
    // `stripe_deposit_plat_{pi}` key — a re-delivered checkout.session.completed
    // P2002's here and the advertiser credit P2002's above, so both sides
    // stay balanced regardless of which side's duplicate fires first.
    const platIdempotencyKey = `stripe_deposit_plat_${result.paymentIntentId}`;
    try {
      await this.prisma.platformLedger.create({
        data: {
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: result.amountMinor,
          currency: result.currency.toUpperCase(),
          bucket: 'cash',
          referenceId: result.paymentIntentId,
          idempotencyKey: platIdempotencyKey,
          description: `Stripe deposit cash received — session ${sessionId}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(`Duplicate platform cash entry for paymentIntent ${result.paymentIntentId} — skipping`);
      } else {
        throw err;
      }
    }

    // Update webhook event as processed
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
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

    // Find the original deposit CREDITS tied to this payment intent that
    // are not yet reversed. Scope to entryType: 'credit' so we don't pick
    // up prior 'refund' rows (also keyed by stripePaymentIntentId, status
    // 'confirmed') — without this filter, a retried charge.refunded delivery
    // would iterate the prior refund rows too and create NEW refund rows
    // reversing them, double-counting the refund against the advertiser.
    // (Campaign debits never carry stripePaymentIntentId, so they're never
    // picked up here — already-served ad spend is correctly not refunded.)
    const entries = await this.prisma.advertiserLedger.findMany({
      where: {
        stripePaymentIntentId: details.paymentIntentId,
        entryType: 'credit',
        status: { notIn: ['reversed', 'void'] },
      },
    });

    if (entries.length === 0) {
      this.logger.warn(
        `No active ledger entries found for paymentIntent ${details.paymentIntentId} in refund ${event.id}`,
      );
      // Still mark as processed
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    const totalRefunded = details.amountMinor;

    // Create a reversal entry for each active entry on this payment intent.
    // Each refund row is idempotent on `stripe_refund_{pi}_{refundId}_{entryId}`
    // (so a re-delivered webhook for the SAME refund.id is a no-op P2002 skip).
    //
    // The parent-row status flip is done via a CAS `updateMany` (status not
    // already `reversed`/`void`) gated on an aggregate computed INSIDE the
    // same `$transaction` as the refund create. The previous code computed
    // the aggregate and flipped the parent as two separate non-transactional
    // writes — two concurrent `charge.refunded` deliveries on the same
    // paymentIntent could each read each other's refund rows in the
    // aggregate and early-flip the same parent; worse, the bare
    // `update({ where: { id } })` had no status guard so it would re-mark an
    // already-`reversed` row, masking the contention. The CAS + in-tx
    // aggregate closes both windows: only one delivery wins the flip and it
    // wins it atomically with its threshold read.
    for (const entry of entries) {
      const reversalAmount = Math.min(entry.amountMinor, totalRefunded);
      if (reversalAmount <= 0) continue;

      const idempotencyKey = `stripe_refund_${details.paymentIntentId}_${refund.id}_${entry.id}`;
      const platRefundIdempotencyKey = `stripe_refund_plat_${details.paymentIntentId}_${refund.id}_${entry.id}`;
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        try {
          await tx.advertiserLedger.create({
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
          // P2002 = a prior delivery already recorded this same refund row
          // for this entry — idempotent skip, continue to the parent flip.
          if (getErrorCode(err) !== 'P2002') throw err;
          this.logger.warn(`Duplicate refund entry for ${idempotencyKey} — skipping`);
        }

        // Platform cash side of the refund — debit the cash bucket back so
        // the platform's books reflect the outbound cash. Idempotent on the
        // paired key. A re-delivery P2002's on both advertiser + platform
        // sides symmetrically.
        try {
          await tx.platformLedger.create({
            data: {
              entryType: 'refund',
              status: 'confirmed',
              amountMinor: reversalAmount,
              currency: details.currency.toUpperCase(),
              bucket: 'cash',
              referenceId: details.paymentIntentId,
              idempotencyKey: platRefundIdempotencyKey,
              description: `Stripe refund cash returned — refund ${refund.id}`,
            },
          });
        } catch (err: unknown) {
          if (getErrorCode(err) !== 'P2002') throw err;
          this.logger.warn(`Duplicate platform refund entry for ${platRefundIdempotencyKey} — skipping`);
        }

        // Re-aggregate INSIDE the transaction: the threshold now reflects
        // every refund row visible at this serializable point, so the
        // flip decision is consistent with the refund write above.
        const totalReversed = await tx.advertiserLedger.aggregate({
          where: {
            stripePaymentIntentId: details.paymentIntentId,
            entryType: 'refund',
          },
          _sum: { amountMinor: true },
        });
        if ((totalReversed._sum.amountMinor ?? 0) < entry.amountMinor) {
          return; // not yet fully reversed — leave parent in its active state
        }

        // CAS flip: only wins if the parent row is still in an active
        // status. A concurrent delivery that already flipped it sees
        // count === 0 here and is a clean no-op (no re-mark, no error).
        const cas = await tx.advertiserLedger.updateMany({
          where: { id: entry.id, status: { notIn: ['reversed', 'void'] } },
          data: { status: 'reversed' },
        });
        if (cas.count === 0) {
          this.logger.warn(
            `Parent entry ${entry.id} already reversed/void — refund ${refund.id} recorded but flip skipped`,
          );
        }
      });
    }

    // Update webhook event as processed
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Refund processed: paymentIntent=${details.paymentIntentId}, amount=${totalRefunded} ${details.currency}`,
    );
  }

  /**
   * Dispute created — flag for review AND freeze the disputed funds.
   *
   * Money-freeze: the disputed amount must not be spendable by the advertiser
   * during the dispute window. We locate the original deposit credit row(s)
   * for this paymentIntent and CAS-flip them to `status: 'held'` (gated on
   * `status: 'confirmed'` so a re-delivery or a second dispute can't double-
   * hold an already-held row), then write a `hold` ledger entry tying the
   * freeze to the dispute id. The cron that matures held developer earnings
   * and any campaign-spend path respect `held` status — held advertiser credit
   * is excluded from "available balance" computations everywhere.
   *
   * `charge.dispute.closed` releases the hold (won) or writes it off (lost).
   */
  private async handleDispute(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const details = await this.stripe.getDisputeDetails(dispute);

    if (!details.paymentIntentId) {
      this.logger.warn(`Dispute event ${event.id} has no payment_intent — cannot flag`);
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
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
        where: { provider: 'stripe', eventId: event.id },
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
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    // ── Money freeze ──
    // Locate all confirmed credit rows for this paymentIntent (a single
    // deposit is one row, but we guard against a future where a deposit may
    // be split across rows). Flip each that is still `confirmed` to `held`,
    // tagging it with the dispute id so the close handler can find it. A
    // re-delivered `charge.dispute.created` (or a second dispute on the same
    // charge) hits `status: 'held'` already and the CAS reports count === 0 —
    // the no-op is correct, the hold row write below is idempotent on key.
    const creditEntries = await this.prisma.advertiserLedger.findMany({
      where: {
        stripePaymentIntentId: details.paymentIntentId,
        entryType: 'credit',
        status: { in: ['confirmed', 'held'] },
      },
    });

    for (const entry of creditEntries) {
      const holdAmount = Math.min(entry.amountMinor, details.amountMinor);
      if (holdAmount <= 0) continue;

      const holdIdempotencyKey = `stripe_dispute_hold_${dispute.id}_${entry.id}`;
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Write the hold entry (idempotent by dispute+entry).
        try {
          await tx.advertiserLedger.create({
            data: {
              advertiserId: entry.advertiserId,
              campaignId: entry.campaignId,
              stripePaymentIntentId: details.paymentIntentId,
              stripeDisputeId: dispute.id,
              entryType: 'hold',
              status: 'held',
              amountMinor: holdAmount,
              currency: entry.currency,
              idempotencyKey: holdIdempotencyKey,
              description: `Dispute hold — dispute ${dispute.id} on paymentIntent ${details.paymentIntentId}`,
            },
          });
        } catch (err: unknown) {
          if (getErrorCode(err) !== 'P2002') throw err;
          this.logger.warn(`Duplicate dispute hold ${holdIdempotencyKey} — skipping create`);
        }

        // CAS flip the parent credit row to `held`, only if still `confirmed`.
        // An already-`held` row (re-delivery / second dispute) reports
        // count === 0 and we proceed — the hold entry write above is also
        // idempotent, so the whole freeze is safe to re-run.
        await tx.advertiserLedger.updateMany({
          where: { id: entry.id, status: 'confirmed' },
          data: { status: 'held', stripeDisputeId: dispute.id },
        });
      });
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
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Dispute flagged + frozen: paymentIntent=${details.paymentIntentId}, advertiser=${advertiserId}, reason=${details.reason}`,
    );
  }

  /**
   * Dispute closed — release the hold (won) or write it off (lost).
   *
   * Stripe's `dispute.status` at closure is one of:
   *   - `won`  → the dispute was resolved in our favor. The held advertiser
   *     credit is released back to `confirmed` so the advertiser can spend
   *     it again. The `hold` ledger row is matched by a `release` row.
   *   - `lost` → the disputed amount was debited from our Stripe account.
   *     The held credit is written off (`reversed`) — the advertiser's
   *     balance is reduced by the disputed amount because the cash left the
   *     platform. The `hold` row is matched by a `reversal` row. We do NOT
   *     auto-issue an advertiser-facing refund here; the deposit already
   *     left via Stripe's debit.
   *
   * Idempotency: every row write is keyed by the dispute id, so a re-delivered
   * `charge.dispute.closed` is a clean P2002 no-op on the writes; the parent
   * CAS flip is gated on `status: 'held'` so re-processing already-settled
   * rows reports count === 0.
   */
  private async handleDisputeClosed(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const details = await this.stripe.getDisputeDetails(dispute);
    const won = dispute.status === 'won';

    if (!details.paymentIntentId) {
      this.logger.warn(`Dispute-closed event ${event.id} has no payment_intent — skipping`);
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    // Locate the held credit rows for this dispute.
    const heldEntries = await this.prisma.advertiserLedger.findMany({
      where: {
        stripeDisputeId: dispute.id,
        status: 'held',
      },
    });

    for (const entry of heldEntries) {
      const settleIdempotencyKey = `stripe_dispute_${won ? 'release' : 'reversal'}_${dispute.id}_${entry.id}`;
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Write the offsetting entry (`release` on won, `reversal` on lost) —
        // idempotent by dispute+entry so re-deliveries are clean no-ops.
        try {
          await tx.advertiserLedger.create({
            data: {
              advertiserId: entry.advertiserId,
              campaignId: entry.campaignId,
              stripePaymentIntentId: details.paymentIntentId,
              stripeDisputeId: dispute.id,
              entryType: won ? 'release' : 'reversal',
              status: won ? 'confirmed' : 'reversed',
              amountMinor: entry.amountMinor,
              currency: entry.currency,
              idempotencyKey: settleIdempotencyKey,
              description: won
                ? `Dispute won — released hold ${dispute.id}`
                : `Dispute lost — written off ${dispute.id}`,
            },
          });
        } catch (err: unknown) {
          if (getErrorCode(err) !== 'P2002') throw err;
          this.logger.warn(`Duplicate dispute settlement ${settleIdempotencyKey} — skipping create`);
        }

        // CAS flip the parent held row:
        //   won  → back to `confirmed` (re-spendable)
        //   lost → `reversed`           (balance reduced)
        // Gated on `status: 'held'` so a re-delivered close event sees the
        // already-flipped row and reports count === 0 (clean no-op).
        await tx.advertiserLedger.updateMany({
          where: { id: entry.id, status: 'held' },
          data: { status: won ? 'confirmed' : 'reversed' },
        });
      });
    }

    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Dispute closed (${dispute.status}): dispute=${dispute.id}, entries=${heldEntries.length}`,
    );
  }

  /**
   * Stripe `payout.paid` — a Stripe Connect payout to a connected account
   * succeeded. The MVP developer-payout flow uses PayPal/manual providers,
   * so this handler is a forward-compatible hook for when Stripe Connect is
   * wired up. We look up the matching `PayoutTransaction` by `providerTxId`
   * (the Stripe payout id) and, if found, CAS-flip the parent `PayoutRequest`
   * from `approved`/`processing` → `paid`. Idempotent: an already-`paid`
   * request is a no-op.
   *
   * If no matching transaction is found ( Stripe Connect not yet enabled ),
   * we simply acknowledge receipt — Stripe might legitimately send payout
   * events for platform-level payouts unrelated to per-developer payouts.
   */
  private async handlePayoutPaid(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as Stripe.Payout;
    const providerTxId = payout.id;

    const tx = await this.prisma.payoutTransaction.findFirst({
      where: { provider: 'stripe_connect', providerTxId },
      include: { payoutRequest: true },
    });

    if (!tx) {
      this.logger.log(
        `Stripe payout.paid for ${providerTxId} — no matching PayoutTransaction (likely platform-level payout), acknowledging`,
      );
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    // CAS flip payout_request from approved/processing → paid. Idempotent:
    // an already-paid row is untouched (count === 0) — and that's fine.
    const paidAt = payout.arrival_date ? new Date(payout.arrival_date * 1000) : new Date();
    const claimed = await this.prisma.payoutRequest.updateMany({
      where: { id: tx.payoutRequestId, status: { in: ['approved', 'processing'] } },
      data: { status: 'paid', paidAt },
    });

    // Mark the per-provider transaction row too — its own terminal state.
    await this.prisma.payoutTransaction.updateMany({
      where: { id: tx.id, status: { in: ['approved', 'processing'] } },
      data: { status: 'paid', paidAt },
    });

    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Stripe payout.paid: payoutRequest=${tx.payoutRequestId}, providerTxId=${providerTxId}, claimed=${claimed.count}`,
    );
  }

  /**
   * Stripe `payout.failed` — a Stripe Connect payout failed. Forward-
   * compatible hook (see handlePayoutPaid). When a matching PayoutTransaction
   * is found, flip the parent `PayoutRequest` to `failed` (gated on
   * `approved`/`processing`) and record the failure reason on the
   * `PayoutTransaction`. The held developer earnings allocations remain
   * 'confirmed' on the earnings ledger — the payout can be retried by an
   * admin via `processPayout` after correcting the destination account.
   */
  private async handlePayoutFailed(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as Stripe.Payout;
    const providerTxId = payout.id;

    const tx = await this.prisma.payoutTransaction.findFirst({
      where: { provider: 'stripe_connect', providerTxId },
      include: { payoutRequest: true },
    });

    if (!tx) {
      this.logger.log(
        `Stripe payout.failed for ${providerTxId} — no matching PayoutTransaction, acknowledging`,
      );
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    // The Stripe `Payout` resource surfaces failure detail only on expanded
    // sub-resources; for the webhook we record the payout id + status as the
    // failure reason so an admin can correlate to the Stripe dashboard. The
    // authoritative terminal state lives on the row, not this string.
    const failureReason = `Stripe payout ${payout.id} failed (status=${payout.status})`;
    const claimed = await this.prisma.payoutRequest.updateMany({
      where: { id: tx.payoutRequestId, status: { in: ['approved', 'processing'] } },
      data: { status: 'failed' },
    });

    await this.prisma.payoutTransaction.updateMany({
      where: { id: tx.id, status: { in: ['approved', 'processing'] } },
      data: { status: 'failed', failureReason: `Stripe payout failed: ${failureReason}` },
    });

    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });

    this.logger.log(
      `Stripe payout.failed: payoutRequest=${tx.payoutRequestId}, providerTxId=${providerTxId}, reason=${failureReason}, claimed=${claimed.count}`,
    );
  }
}
