import { Request } from 'express';
import Stripe from 'stripe';
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleInit,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { FraudFlagStatus, FraudFlagType, FraudSeverity, Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { EventBus } from '../common/events/event-bus';
import { getErrorCode, getErrorMessage } from '../common/utils/errors';
import { assertSafeJson } from '../common/utils/json-value';
import { PrismaService } from '../config/prisma.service';
import { ReferralService } from '../referral/referral.service';
import { StripeProvider } from './providers';

type RawBodyRequest = Request & { rawBody?: Buffer | string };

const WEBHOOK_EVENT = 'stripe.webhook';

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
@ApiTags('Stripe Webhooks')
@Controller('payout/stripe')
export class StripeWebhookController implements OnModuleInit {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeProvider,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eventBus: EventBus,
    private readonly referral: ReferralService,
  ) {}

  onModuleInit() {
    // Subscribe the reconciliation handler to the bus. The handler receives
    // `{ event }` and performs its own failure recovery (reset to 'pending'
    // for retry) so async dispatch keeps the row reclaimable.
    this.eventBus.on(WEBHOOK_EVENT, (payload) => {
      const { event } = payload as { event: Stripe.Event };
      return this.runProcessing(event);
    });
  }

  @ApiOperation({ summary: 'Receive Stripe webhook' })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: RawBodyRequest) {
    if (!this.stripe.isEnabled()) {
      this.logger.warn('Stripe webhook received but Stripe is not configured');
      // Returning 2xx here would tell Stripe the event was accepted when it
      // was not — so we fail closed with 503 (issue A-062).
      throw new HttpException(
        { received: false, reason: 'stripe_not_configured' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      this.logger.warn('Stripe webhook missing signature header');
      throw new HttpException(
        { received: false, reason: 'missing_signature' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Stripe requires the raw request body for signature verification.
    // express.raw() exposes it as req.body; some adapters expose req.rawBody.
    const rawBody =
      req.rawBody ??
      (Buffer.isBuffer(req.body) || typeof req.body === 'string' ? req.body : undefined);
    if (!rawBody) {
      this.logger.error(
        'Stripe webhook missing raw body — raw-body middleware may not be configured before JSON parsing',
      );
      throw new HttpException(
        { received: false, reason: 'missing_raw_body' },
        HttpStatus.BAD_REQUEST,
      );
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.verifyWebhookSignature(rawBody, sig);
    } catch (err: unknown) {
      this.logger.error(`Stripe webhook signature verification failed: ${getErrorMessage(err)}`);
      // A bad signature means this is not a genuine Stripe event. Returning
      // 400 (not 2xx) stops Stripe from retrying an event we can never
      // process, and — critically — does NOT acknowledge a (potentially
      // money-moving) event we did not verify (issue A-062).
      throw new HttpException(
        { received: false, reason: 'signature_verification_failed' },
        HttpStatus.BAD_REQUEST,
      );
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
      // Validate the externally-supplied event shape before persisting it to
      // the JSON column (rejects prototype-pollution / non-serializable input).
      assertSafeJson(event, `event.${event.id}`);
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
      // The event was valid (signature verified) but could not be read back.
      // Fail with 5xx so Stripe retries rather than dropping a (potentially
      // money-moving) event (issue A-062).
      throw new HttpException(
        { received: false, reason: 'persistence_race' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      this.logger.warn(
        `Stripe event ${event.id} stalled in processing for ${Math.round(stalledMs / 1000)}s — reclaiming`,
      );
    }

    // 3. Atomic claim: pending (or stalled processing) → processing.
    //    Scope by provider so the claim never touches another provider's row
    //    even if an id coincided across providers before the
    //    provider_eventId composite-unique migration.
    const claimed = await this.prisma.webhookEvent.updateMany({
      where: {
        provider: 'stripe',
        eventId: event.id,
        processingStatus: existing.processingStatus,
        processedAt: existing.processedAt,
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

    // External Stripe delivery is processed synchronously. A 2xx is returned
    // only after ledger reconciliation and the audit record have committed.
    await this.runProcessing(event, true);
    return { received: true };
  }

  /**
   * Run the reconciliation handler and perform its own failure recovery: on
   * error, reset the webhook event to 'pending' so the next delivery (or the
   * 30-min stall-reclaim path) can reprocess it. Used by both the inline and
   * async dispatch paths.
   */
  private async runProcessing(event: Stripe.Event, rethrow = false): Promise<void> {
    try {
      await this.processEvent(event);
    } catch (err: unknown) {
      this.logger.error(`Processing failed for Stripe event ${event.id}: ${getErrorMessage(err)}`);
      // Reset to 'pending' so the next retry can reclaim.
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id, processingStatus: 'processing' },
        data: { processingStatus: 'pending' },
      });
      if (rethrow) {
        throw new HttpException(
          { received: false, reason: 'processing_failed' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
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
        this.logger.log(
          `Dispute funds withdrawn for event ${event.id} — already settled at close, acknowledging`,
        );
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
      // Mark this webhook event 'processed' — Stripe has no more data to
      // deliver and will never be able to make this event bookable through
      // retry. Leaving it 'processing' would pollute the reclaim path forever
      // and silently drop future deposits from the same Stripe customer (the
      // webhook_event row would block any retry from being reinserted as a
      // fresh 'pending' row). (Issue A-062.)
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id, processingStatus: 'processing' },
        data: { processingStatus: 'processed', error: 'missing_advertiserId_in_checkout_metadata' },
      });
      return;
    }

    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: result.advertiserId },
      include: { user: { select: { status: true } } },
    });
    if (!advertiser) {
      this.logger.error(`Advertiser ${result.advertiserId} not found for checkout ${sessionId}`);
      // Same as above: this is a permanent business error, not transient; mark
      // the row processed so it doesn't sit in 'processing' forever.
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id, processingStatus: 'processing' },
        data: { processingStatus: 'processed', error: 'advertiser_not_found' },
      });
      return;
    }
    if (advertiser.user.status !== 'active') {
      // The payment completed after the owner was restricted/deleted. Record
      // the real cash receipt, but do not resurrect account linkage or grant
      // spendable advertiser credit. The durable webhook error + audit entry
      // routes this payment to operator refund/reconciliation review.
      await this.prisma.platformLedger.upsert({
        where: { idempotencyKey: `stripe_deposit_plat_${result.paymentIntentId}` },
        create: {
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: result.amountMinor,
          currency: result.currency.toUpperCase(),
          bucket: 'cash',
          referenceId: result.paymentIntentId,
          idempotencyKey: `stripe_deposit_plat_${result.paymentIntentId}`,
          description: `Orphaned Stripe deposit awaiting refund review — session ${sessionId}`,
        },
        update: {},
      });
      await this.audit.logStrict({
        actorId: 'stripe_webhook',
        actorRole: 'system',
        action: 'stripe_deposit_refund_required',
        targetType: 'advertiser',
        targetId: advertiser.id,
        beforeSnap: {
          paymentIntentId: result.paymentIntentId,
          amountMinor: String(result.amountMinor),
          currency: result.currency,
          userStatus: advertiser.user.status,
        },
      });
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id, processingStatus: 'processing' },
        data: {
          processingStatus: 'processed',
          processedAt: new Date(),
          error: 'advertiser_inactive_refund_required',
        },
      });
      return;
    }

    // Wire the Stripe customer ID to the Advertiser record. CAS-gated on
    // `stripeCustomerId: null` so two concurrent checkout.session.completed
    // deliveries for the same advertiser (possible if the user double-clicks
    // the deposit button before the first session resolves, or a Stripe
    // retry delivery races itself) both pass the outer read but only one
    // wins the flip. The second's update returns count=0 and we leave the
    // winner's value intact — the field has `@@unique([stripeCustomerId])`
    // semantics (one Stripe customer = one advertiser), and overwriting a
    // pre-existing customerId would also violate the unique constraint.
    if (result.stripeCustomerId) {
      const wire = await this.prisma.advertiser.updateMany({
        where: { id: advertiser.id, stripeCustomerId: null },
        data: { stripeCustomerId: result.stripeCustomerId },
      });
      if (wire.count > 0) {
        this.logger.log(
          `Wired stripeCustomerId=${result.stripeCustomerId} to advertiser ${advertiser.id}`,
        );
      }
    }

    // Record deposit in advertiser ledger (credit) — idempotent by paymentIntentId
    const idempotencyKey = `stripe_deposit_${result.paymentIntentId}`;
    let depositCreated = false;
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
      depositCreated = true;
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(
          `Duplicate deposit for paymentIntent ${result.paymentIntentId} — skipping`,
        );
      } else {
        throw err;
      }
    }

    // Refunds can arrive before checkout completion. The refund handler can
    // record the real cash outflow without knowing the advertiser; on the first
    // successful deposit insert, attach those prior cash refunds to the
    // advertiser ledger. A duplicate checkout does not repeat this catch-up.
    if (depositCreated) {
      const earlierCashRefunds = await this.prisma.platformLedger.findMany({
        where: {
          bucket: 'cash',
          entryType: 'refund',
          status: 'confirmed',
          referenceId: result.paymentIntentId,
        },
        select: { id: true, amountMinor: true, currency: true },
      });
      for (const cashRefund of earlierCashRefunds) {
        await this.prisma.advertiserLedger.upsert({
          where: { idempotencyKey: `stripe_refund_catchup_${cashRefund.id}` },
          create: {
            advertiserId: advertiser.id,
            stripePaymentIntentId: result.paymentIntentId,
            entryType: 'refund',
            status: 'confirmed',
            amountMinor: cashRefund.amountMinor,
            currency: cashRefund.currency,
            idempotencyKey: `stripe_refund_catchup_${cashRefund.id}`,
            description: `Out-of-order Stripe refund reconciled after deposit — ${result.paymentIntentId}`,
          },
          update: {},
        });
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
        this.logger.warn(
          `Duplicate platform cash entry for paymentIntent ${result.paymentIntentId} — skipping`,
        );
      } else {
        throw err;
      }
    }

    // ── A-019: activate campaigns that were approved while unfunded ──
    // A campaign can reach `approved` before the advertiser has deposited. The
    // Stripe deposit webhook now credits the advertiser balance, so activate
    // any `approved` campaign that has an approved creative, remaining budget,
    // and a positive same-currency balance. This closes the gap where an
    // approved-then-funded campaign would otherwise never start serving.
    // Activate every eligible campaign in one database-side statement. The
    // previous findMany + per-campaign balance query was unbounded N+1 work on
    // the webhook request and could time out for a large advertiser.
    const activatedCount = await this.prisma.$executeRaw(Prisma.sql`
      WITH balances AS (
        SELECT
          "advertiserId",
          "currency",
          SUM(
            CASE
              WHEN "entryType" IN ('credit', 'reversal') AND "status" = 'confirmed'
                THEN "amountMinor"
              WHEN "entryType" = 'debit' AND "status" = 'confirmed'
                THEN -"amountMinor"
              WHEN "entryType" = 'refund' AND "status" IN ('pending', 'confirmed')
                THEN -"amountMinor"
              ELSE 0
            END
          )::bigint AS balance
        FROM "advertiser_ledger"
        WHERE "advertiserId" = ${advertiser.id}
        GROUP BY "advertiserId", "currency"
      )
      UPDATE "campaigns" c
      SET "status" = 'active', "activatedAt" = NOW(), "updatedAt" = NOW()
      FROM balances b
      WHERE c."advertiserId" = b."advertiserId"
        AND c."currency" = b."currency"
        AND b.balance > 0
        AND c."status" = 'approved'
        AND c."budgetSpentMinor" < c."budgetTotalMinor"
        AND EXISTS (
          SELECT 1 FROM "ad_creatives" cr
          WHERE cr."campaignId" = c."id" AND cr."status" = 'approved'
        )
    `);
    if (activatedCount > 0) {
      this.logger.log(
        `Activated ${activatedCount} previously-unfunded campaign(s) after deposit for advertiser ${advertiser.id}`,
      );
    }

    this.logger.log(
      `Recorded Stripe deposit: ${result.amountMinor} ${result.currency} for advertiser ${advertiser.id}`,
    );

    // Audit: Stripe deposit — key money-in event, no actor id (system).
    await this.audit.logStrict({
      actorId: 'stripe_webhook',
      actorRole: 'system',
      action: 'stripe_deposit',
      targetType: 'advertiser',
      targetId: advertiser.id,
      beforeSnap: {
        amountMinor: String(result.amountMinor),
        currency: result.currency,
        paymentIntentId: result.paymentIntentId,
        sessionId,
      },
    });
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
  }

  /** Reverse advertiser ledger entries when a charge is refunded */
  private async handleRefund(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    const details = await this.stripe.getRefundDetails(refund);

    if (!details.paymentIntentId) {
      this.logger.warn(`Refund event ${event.id} has no payment_intent — cannot reverse`);
      // Mark the webhook event processed so the row converges to a terminal
      // state — otherwise the 30-min stall-reclaim path would re-pull this
      // event forever and Stripe would re-deliver on top of it. Without a
      // payment_intent we have nothing to reconcile; the early-return is
      // intentional and terminating. (Issue A-062.)
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
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
    //
    // `stripeDisputeId: null` excludes credit rows that belong to the
    // dispute machinery: the won-dispute restore path writes a fresh
    // `credit` stamped with the dispute id (see handleDisputeClosed), and
    // that slice is under the dispute's control, not the refund's. Without
    // this filter a late/duplicate refund could iterate and reverse that
    // won-restore credit, removing funds the platform actually holds. The
    // decremented parent deposit credit (stripeDisputeId stays null on the
    // parent — only the `hold` child row is stamped) remains pickable and
    // reverses only its undisputed remainder, which is correct.
    const entries = await this.prisma.advertiserLedger.findMany({
      where: {
        stripePaymentIntentId: details.paymentIntentId,
        entryType: 'credit',
        status: { notIn: ['reversed', 'void'] },
        stripeDisputeId: null,
      },
    });

    const totalRefunded = BigInt(details.amountMinor);
    let remaining = totalRefunded;

    // ── Platform cash side of the refund (written ONCE per refund, not per entry) ──
    // The inbound-cash side (`handlePaymentSuccess`) writes exactly one platform
    // `cash` credit per paymentIntent, keyed `stripe_deposit_plat_{pi}` (no
    // entryId). To keep the books balanced, the outbound-cash side must mirror
    // that: ONE platform `cash` refund row per Stripe refund, for the actual
    // refund amount, keyed `stripe_refund_plat_{pi}_{refundId}` (no entryId).
    // Writing it inside the per-advertiser-entry loop (keyed per-entry)
    // produced N platform refund rows for a PI with N credit rows, summing to
    // more than the actual refund — a platform-cash double-count.
    //
    // This write runs BEFORE the `entries.length === 0` check below so the
    // cash side always mirrors Stripe's outbound refund regardless of
    // whether advertiser credit rows exist. If the advertiser credit was
    // already reversed (duplicate delivery, or a refund arriving after a
    // prior full refund/won-dispute settle), Stripe has still moved the
    // money out — skipping this write would leave the platform cash ledger
    // permanently overstated by the refund amount. The key is idempotent on
    // (paymentIntent, refundId), so a re-delivery is a safe P2002 no-op.
    const platRefundIdempotencyKey = `stripe_refund_plat_${details.paymentIntentId}_${refund.id}`;
    try {
      await this.prisma.platformLedger.create({
        data: {
          entryType: 'refund',
          status: 'confirmed',
          amountMinor: totalRefunded,
          currency: details.currency.toUpperCase(),
          bucket: 'cash',
          referenceId: details.paymentIntentId,
          idempotencyKey: platRefundIdempotencyKey,
          description: `Stripe refund cash returned — refund ${refund.id}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(
          `Duplicate platform refund entry for ${platRefundIdempotencyKey} — skipping`,
        );
      } else {
        throw err;
      }
    }

    if (entries.length === 0) {
      // The cash side above was still written (Stripe moved money out), but
      // there is no advertiser credit row to reverse against — either the
      // deposit webhook hasn't landed yet (out-of-order delivery) or the
      // credit was already fully reversed by a prior delivery. Mark the
      // event processed; the cash-white reconciliation (`getMoneyIntegrityReport`)
      // surfaces any residual drift. A retry would not help once the credit
      // is gone, and the deposit-not-yet-arrived case is handled by the
      // separate deposit webhook path, not by re-iterating refunds.
      this.logger.warn(
        `No active ledger entries found for paymentIntent ${details.paymentIntentId} in refund ${event.id} — cash refund recorded, advertiser side skipped`,
      );
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    // ── Restore parent-deposit remainder before reversing ──
    // Issue A-063 / Round 27 Fix 1: handleDispute.decrement freezes the
    // disputed slice by decrementing the parent deposit credit row's
    // `amountMinor` by the held amount (the separate `hold` ledger row
    // carries the full frozen value). When a refund arrives on a payment
    // intent that was ALSO disputed, the per-entry reversal loop below
    // bounds `reversalAmount = min(entry.amountMinor, remaining)` — but
    // `entry.amountMinor` is now the **post-dispute decrement** remainder
    // (e.g. 0 on a fully-disputed deposit). Net result: a 0-amount advertiser
    // refund row, the parent still flips to `reversed`, and the full
    // deposit balance becomes orphaned as spendable against a deposit
    // that's been returned to the cardholder.
    //
    // Fix: before the reversal loop, re-increment each parent credit row by
    // every held-slice that was decremented from it. The held row's
    // `amountMinor` IS the slice that was removed at dispute time; adding it
    // back restores the parent to its original deposit value, and the
    // subsequent reversal loop writes the correct full refund. CAS-gated on
    // `status: { notIn: ['reversed','void'] }` so we never touch a parent
    // that's already been settled by a prior full refund.
    //
    // Pairing hold → parent: same `stripePaymentIntentId` with the matching
    // (advertiserId, campaignId) triple used by the dispute decrement.
    // Idempotent: a re-delivery of the same refund finds the holds already
    // retired (status ≠ 'held') and skips them.
    const heldRows = await this.prisma.advertiserLedger.findMany({
      where: {
        stripePaymentIntentId: details.paymentIntentId,
        entryType: 'hold',
        status: 'held',
      },
      select: {
        id: true,
        amountMinor: true,
        advertiserId: true,
        campaignId: true,
        currency: true,
      },
    });
    for (const hold of heldRows) {
      await this.prisma.advertiserLedger.updateMany({
        where: {
          stripePaymentIntentId: details.paymentIntentId,
          advertiserId: hold.advertiserId,
          campaignId: hold.campaignId,
          entryType: 'credit',
          status: { notIn: ['reversed', 'void'] },
          stripeDisputeId: null,
        },
        data: { amountMinor: { increment: hold.amountMinor } },
      });
    }

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
      if (remaining <= 0n) break;
      const reversalAmount = entry.amountMinor < remaining ? entry.amountMinor : remaining;
      remaining -= reversalAmount;

      const idempotencyKey = `stripe_refund_${details.paymentIntentId}_${refund.id}_${entry.id}`;
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

        // Keep the original deposit credit immutable/confirmed. The central
        // balance formula subtracts confirmed refund rows; also reversing the
        // parent credit would subtract the same refund twice.
      });
    }

    // ── Retire any active dispute hold rows for this payment intent ──
    // A refund returns money to the cardholder regardless of the dispute
    // outcome — the dispute becomes moot (Stripe typically closes it when a
    // charge is fully refunded). Any held slice that was frozen by a
    // `charge.dispute.created` delivery is superseded by this refund; we
    // retire the hold row(s) so the dispute-close handler (won/lost) has
    // nothing left to erroneously release or write-off. The hold retire is
    // CAS-gated on `status: 'held'` and no new hold-specific reversal row
    // is needed — the advertiser's deposit credit has already been fully
    // reversed above (the parent row and any won-restore credits excluded by
    // `stripeDisputeId: null`). The net effect is a clean advertiser ledger
    // with no orphaned hold rows awaiting a dispute resolution that won't
    // come.
    const holdRows = await this.prisma.advertiserLedger.findMany({
      where: {
        stripePaymentIntentId: details.paymentIntentId,
        entryType: 'hold',
        status: 'held',
      },
      select: { id: true },
    });
    for (const hold of holdRows) {
      await this.prisma.advertiserLedger.updateMany({
        where: { id: hold.id, status: 'held' },
        data: { status: 'reversed' },
      });
      this.logger.log(
        `Retired dispute hold ${hold.id} — superseded by refund ${refund.id} on PI ${details.paymentIntentId}`,
      );
    }

    this.logger.log(
      `Refund processed: paymentIntent=${details.paymentIntentId}, amount=${totalRefunded} ${details.currency}`,
    );

    // Audit: Stripe refund — money out event
    await this.audit.logStrict({
      actorId: 'stripe_webhook',
      actorRole: 'system',
      action: 'stripe_refund',
      targetType: 'payment_intent',
      targetId: details.paymentIntentId ?? '',
      beforeSnap: {
        amountMinor: String(totalRefunded),
        currency: details.currency,
        refundId: refund.id,
      },
    });
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
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

    // ── State guard: don't freeze an already-resolved dispute ──
    // `charge.dispute.created` may be re-delivered after a `charge.dispute.closed`
    // has already run (won path): the parent credit row was released back to
    // `confirmed` and the hold row was settled. Re-freezing here would
    // re-`held` the parent with no future close event to release it — the
    // deposit gets stuck frozen. Skip the freeze entirely if the dispute is
    // not in an open status. (Stripe dispute statuses: `warning_needs_response`,
    // `needs_response`, `warning_under_review`, `under_review`, `challenging`.
    // The terminal ones: `won`, `lost`, `warning_closed`, `closed`.)
    if (
      details.status === 'won' ||
      details.status === 'lost' ||
      details.status === 'warning_closed' ||
      details.status === 'closed'
    ) {
      this.logger.warn(
        `Dispute ${dispute.id} is already in terminal status '${details.status}' — not freezing (event ${event.id})`,
      );
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

    let remainingDisputeMinor = BigInt(details.amountMinor);
    for (const entry of creditEntries) {
      const holdAmount =
        entry.amountMinor < remainingDisputeMinor ? entry.amountMinor : remainingDisputeMinor;
      if (holdAmount <= 0) break;

      const holdIdempotencyKey = `stripe_dispute_hold_${dispute.id}_${entry.id}`;
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Write the hold entry (idempotent by dispute+entry).
        let holdCreated = false;
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
          holdCreated = true;
        } catch (err: unknown) {
          if (getErrorCode(err) !== 'P2002') throw err;
          this.logger.warn(`Duplicate dispute hold ${holdIdempotencyKey} — skipping create`);
        }

        // Issue A-063: a PARTIAL dispute must freeze only the disputed slice,
        // not the entire deposit credit. Keep the parent credit `confirmed` but
        // decrement its amount by the held amount; the separate `hold` ledger
        // row (created above) carries exactly `holdAmount`. The centralized
        // balance helper counts only `confirmed` `credit` rows, so spendable
        // balance drops by the disputed amount and the undisputed remainder
        // stays available. The decrement runs ONLY when the hold row was
        // freshly created (not on replay/idempotent skip), preventing a
        // double-decrement on stall-reclaim re-delivery.
        if (holdCreated) {
          await tx.advertiserLedger.updateMany({
            where: { id: entry.id, status: 'confirmed' },
            data: { amountMinor: { decrement: holdAmount } },
          });
        }
      });
      remainingDisputeMinor -= holdAmount;
    }

    // Create a fraud flag for review.
    //
    // Idempotency: a Stripe re-delivery of the same `charge.dispute.created`
    // event (after a transient write failure earlier in the handler — see
    // the processingStatus='pending' reset on transient failures) would
    // otherwise create a SECOND fraud flag pointing at the same dispute,
    // with separate holds already stamped on the earnings rows. The risk:
    //   • Multiple flags inflates `openFraudFlags` admin metrics.
    //   • Each flag independently calls `computeTrustScore`, applying the
    //     penalty N times.
    //   • `resolveFlag` resolves one flag at a time — a stale flag for the
    //     same dispute can leave holds stranded after the legitimate one is
    //     resolved.
    //
    // Fast-path duplicate check. The typed @unique stripeDisputeId column is
    // the authoritative concurrency floor; the P2002 catch below closes the
    // read/create race between distinct Stripe event ids for one dispute.
    const existingForDispute = await this.prisma.fraudFlag.findUnique({
      where: { stripeDisputeId: dispute.id },
      select: { id: true },
    });
    if (existingForDispute) {
      this.logger.warn(
        `Duplicate dispute flag for ${dispute.id} — already flagged as ${existingForDispute.id}, skipping create`,
      );
    } else {
      try {
        await this.prisma.fraudFlag.create({
          data: {
            userId: advertiser.userId,
            stripeDisputeId: dispute.id,
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
          throw err;
        }
      }
    }

    this.logger.log(
      `Dispute flagged + frozen: paymentIntent=${details.paymentIntentId}, advertiser=${advertiserId}, reason=${details.reason}`,
    );

    // Audit: dispute opened — funds frozen, flag created
    await this.audit.logStrict({
      actorId: 'stripe_webhook',
      actorRole: 'system',
      action: 'stripe_dispute_created',
      targetType: 'dispute',
      targetId: dispute.id,
      beforeSnap: {
        paymentIntentId: details.paymentIntentId,
        reason: details.reason,
        amountMinor: String(details.amountMinor),
        advertiserId,
      },
    });
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
  }

  /**
   * Dispute closed — release the hold (won) or write it off (lost).
   *
   * We process the dispute by resolving its specific hold rows. A deposit may
   * have multiple disputes (each with its own `hold` row).
   *
   * 1. Locate all `hold` entries for this dispute.
   * 2. For each: write a matching `release` or `reversal` offsetting row, and
   *    CAS-flip the `hold` row to a terminal state.
   * 3. Settle the parent credit row:
   *    - If won: the parent flips from `held` → `confirmed` ONLY if no other
   *      `hold` rows for this PI remain active.
   *    - If lost: a matching `reversal` is written against the parent, and the
   *      parent flips `held` → `reversed` if its balance is fully depleted.
   *    - Always write a platform `cash` debit for lost disputes to maintain
   *      double-entry conservation.
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

    // Issue A-063: settle each `hold` row created at freeze time. The parent
    // deposit credit was already decremented by the held amount at freeze, so
    // we only operate on the hold slices here:
    //  - Won: restore the disputed funds as a fresh `confirmed` credit and
    //    retire the hold row. The parent credit keeps its decremented balance
    //    plus this restored slice = the original deposit.
    //  - Lost: retire the hold row and write off ONLY the disputed slice (a
    //    `reversal` ledger row + platform cash debit). The parent credit keeps
    //    its decremented balance, so the undisputed remainder stays spendable.
    const holdEntries = await this.prisma.advertiserLedger.findMany({
      where: {
        stripeDisputeId: dispute.id,
        entryType: 'hold',
        status: 'held',
      },
    });

    for (const hold of holdEntries) {
      const settleIdempotencyKey = `stripe_dispute_${won ? 'won' : 'lost'}_${dispute.id}_${hold.id}`;
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (won) {
          try {
            await tx.advertiserLedger.create({
              data: {
                advertiserId: hold.advertiserId,
                campaignId: hold.campaignId,
                stripePaymentIntentId: details.paymentIntentId,
                stripeDisputeId: dispute.id,
                entryType: 'credit',
                status: 'confirmed',
                amountMinor: hold.amountMinor,
                currency: hold.currency,
                idempotencyKey: settleIdempotencyKey,
                description: `Dispute won — funds restored ${dispute.id}`,
              },
            });
          } catch (err: unknown) {
            if (getErrorCode(err) !== 'P2002') throw err;
          }
        } else {
          try {
            await tx.advertiserLedger.create({
              data: {
                advertiserId: hold.advertiserId,
                campaignId: hold.campaignId,
                stripePaymentIntentId: details.paymentIntentId,
                stripeDisputeId: dispute.id,
                entryType: 'reversal',
                status: 'reversed',
                amountMinor: hold.amountMinor,
                currency: hold.currency,
                idempotencyKey: settleIdempotencyKey,
                description: `Dispute lost — written off ${dispute.id}`,
              },
            });
          } catch (err: unknown) {
            if (getErrorCode(err) !== 'P2002') throw err;
          }

          // Platform cash side: debit the cash bucket for the disputed slice.
          const platKey = `stripe_dispute_lost_plat_${dispute.id}_${hold.id}`;
          try {
            await tx.platformLedger.create({
              data: {
                entryType: 'reversal',
                status: 'confirmed',
                amountMinor: hold.amountMinor,
                currency: hold.currency,
                bucket: 'cash',
                referenceId: details.paymentIntentId,
                idempotencyKey: platKey,
                description: `Dispute lost — cash debited ${dispute.id}`,
              },
            });
          } catch (err: unknown) {
            if (getErrorCode(err) !== 'P2002') throw err;
          }
        }

        // Retire the hold row either way.
        await tx.advertiserLedger.updateMany({
          where: { id: hold.id, status: 'held' },
          data: { status: 'reversed' },
        });
      });
    }

    this.logger.log(
      `Dispute closed (${dispute.status}): dispute=${dispute.id}, holds_processed=${holdEntries.length}`,
    );

    // Audit: dispute closed — funds released or written off
    await this.audit.logStrict({
      actorId: 'stripe_webhook',
      actorRole: 'system',
      action: 'stripe_dispute_closed',
      targetType: 'dispute',
      targetId: dispute.id,
      beforeSnap: {
        status: dispute.status,
        holdsProcessed: holdEntries.length,
        paymentIntentId: details.paymentIntentId,
      },
    });
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
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

    // Load the matching PayoutTransaction with its parent request + allocations
    // so we can mirror the admin `markPayoutPaid` reconciliation inside a single
    // transaction. Without including allocations + earnings entries here, the
    // webhook path diverges from the admin path: the PayoutRequest flips to
    // `paid` but the developer's allocated EarningsLedger rows stay `confirmed`
    // — and once the PayoutRequest is no longer in RESERVED_PAYOUT_STATUSES the
    // allocations stop reserving, so the developer can re-request a payout
    // against the same already-paid entries (double-withdrawal).
    const tx = await this.prisma.payoutTransaction.findFirst({
      where: { provider: 'stripe_connect', providerTxId },
      include: {
        payoutRequest: {
          include: { allocations: { include: { earningsEntry: true } } },
        },
      },
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

    const payoutRequest = tx.payoutRequest;
    const payoutRequestId = payoutRequest.id;
    const paidAt = payout.arrival_date ? new Date(payout.arrival_date * 1000) : new Date();

    // Idempotent fast-path: already paid means the webhook is a re-delivery.
    if (payoutRequest.status === 'paid') {
      this.logger.log(`Stripe payout.paid for ${providerTxId} — already paid, acknowledging`);
      await this.referral.processReferralRewards(payoutRequest.userId);
      await this.audit.logStrict({
        actorId: 'stripe_webhook',
        actorRole: 'system',
        action: 'stripe_payout_paid',
        targetType: 'payout_request',
        targetId: payoutRequestId,
        beforeSnap: { providerTxId, replay: true },
      });
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'stripe', eventId: event.id },
        data: { processingStatus: 'processed', processedAt: new Date() },
      });
      return;
    }

    // Collect ALL allocated earnings entry IDs (not just confirmed ones) so
    // the post-check `paidCount === earningsIds.length` below actually
    // detects a concurrent `holdEarnings` that flipped any allocated entry
    // `confirmed → held`. See the markPayoutPaid comment in
    // payout-request.trait.ts for the full rationale.
    const earningsIds = payoutRequest.allocations.map(
      (a: { earningsEntryId: string }) => a.earningsEntryId,
    );

    let claimed = 0;
    try {
      const result = await this.prisma.$transaction(async (txCnx: Prisma.TransactionClient) => {
        // 1. Atomic conditional flip: only from approved/processing.
        const paidUpdate = await txCnx.payoutRequest.updateMany({
          where: { id: payoutRequestId, status: { in: ['approved', 'processing'] } },
          data: { status: 'paid', paidAt },
        });
        if (paidUpdate.count === 0) {
          // Lost the race — re-read to distinguish idempotent vs. conflicting.
          const current = await txCnx.payoutRequest.findUnique({
            where: { id: payoutRequestId },
            select: { status: true },
          });
          if (current?.status === 'paid') return { claimed: 0 as const };
          // A concurrent transition to a *different* terminal state — leave
          // it alone; the failure-reason path will surface the divergence.
          return { claimed: 0 as const, conflict: current?.status ?? 'missing' } as const;
        }

        // 2. Mark the per-provider transaction row (terminal state).
        await txCnx.payoutTransaction.updateMany({
          where: { id: tx.id, status: { in: ['approved', 'processing'] } },
          data: { status: 'paid', paidAt },
        });

        // 3. Flip only the allocated / confirmed earnings to `paid`.
        if (earningsIds.length > 0) {
          await txCnx.earningsLedger.updateMany({
            where: { id: { in: earningsIds }, status: 'confirmed' },
            data: { status: 'paid' },
          });

          // Authoritative post-check: a concurrent fraud `holdEarnings` may have
          // flipped one or more allocated entries from `confirmed` → `held`
          // between the snapshot read and the CAS. The conditional updateMany
          // silently skips those rows; refuse the paid transition if any
          // allocated entry is no longer `paid` to avoid the orphan-held /
          // double-withdrawal bug (see markPayoutPaid comment in payout.service).
          const paidCount = await txCnx.earningsLedger.aggregate({
            where: { id: { in: earningsIds }, status: 'paid' },
            _count: { _all: true },
          });
          if (paidCount._count._all !== earningsIds.length) {
            throw new Error(
              `Stripe payout.paid for ${payoutRequestId}: ${earningsIds.length - paidCount._count._all} allocated earnings are no longer 'confirmed' (likely fraud-held) — refusing to mark paid; Stripe payout will be retried on the next webhook delivery after the hold clears.`,
            );
          }
        }

        await txCnx.platformLedger.upsert({
          where: { idempotencyKey: `developer_payout_cash_${payoutRequestId}` },
          create: {
            entryType: 'reversal',
            status: 'confirmed',
            amountMinor: payoutRequest.approvedAmountMinor ?? payoutRequest.requestedAmountMinor,
            currency: payoutRequest.currency,
            bucket: 'cash',
            referenceId: payoutRequestId,
            idempotencyKey: `developer_payout_cash_${payoutRequestId}`,
            description: `Developer payout cash settled — payout ${payoutRequestId}`,
          },
          update: {},
        });

        return { claimed: 1 as const };
      });
      if ('conflict' in result) {
        throw new Error(
          `Stripe payout.paid for ${payoutRequestId} conflicts with local status '${result.conflict}'`,
        );
      }
      claimed = result.claimed;
    } catch (err: unknown) {
      // Throwing inside the tx rolls back the payoutRequest flip + payoutTx
      // update + earnings flip. Don't mark webhookEvent processed — let
      // Stripe retry. The webhook-layer idempotency (webhookEvent row) stays
      // in 'processing' and will be reclaimed by the 30-min stall path.
      this.logger.error(
        `Stripe payout.paid reconciliation failed for ${payoutRequestId} (will retry): ${getErrorMessage(err)}`,
      );
      throw err;
    }

    this.logger.log(
      `Stripe payout.paid: payoutRequest=${payoutRequestId}, providerTxId=${providerTxId}, claimed=${claimed}`,
    );

    await this.referral.processReferralRewards(payoutRequest.userId);
    await this.audit.logStrict({
      actorId: 'stripe_webhook',
      actorRole: 'system',
      action: 'stripe_payout_paid',
      targetType: 'payout_request',
      targetId: payoutRequestId,
      beforeSnap: { providerTxId, claimed: Boolean(claimed) },
    });
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
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
      include: { payoutRequest: { include: { allocations: true } } },
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

    const failureReason =
      `Stripe bank payout ${payout.id} reached ${payout.status}; ` +
      'the preceding platform transfer may already be in the connected account and requires manual reconciliation';

    // Do not release allocations or mark the request failed. Stripe Connect
    // first transfers funds to the connected account; a later bank-payout
    // failure returns money to that connected account, not necessarily to the
    // platform. Releasing here can double-pay the developer.
    await this.prisma.payoutTransaction.update({
      where: { id: tx.id },
      data: { failureReason },
    });
    this.logger.warn(
      `Stripe payout requires reconciliation: payoutRequest=${tx.payoutRequestId}, providerTxId=${providerTxId}`,
    );

    await this.audit.logStrict({
      actorId: 'stripe_webhook',
      actorRole: 'system',
      action: 'stripe_payout_requires_review',
      targetType: 'payout_request',
      targetId: tx.payoutRequestId,
      beforeSnap: { providerTxId, failureReason },
    });
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'stripe', eventId: event.id },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
  }
}
