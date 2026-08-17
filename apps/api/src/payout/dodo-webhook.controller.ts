import { createHash } from 'crypto';
import { Request } from 'express';
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
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { EventBus } from '../common/events/event-bus';
import { getErrorCode, getErrorMessage } from '../common/utils/errors';
import { assertSafeJson } from '../common/utils/json-value';
import { PrismaService } from '../config/prisma.service';
import { verifyStandardWebhookSignature } from './standard-webhooks';

type RawBodyRequest = Request & { rawBody?: Buffer | string };

/**
 * Dodo Payments webhook controller — receives Dodo events for the deposit
 * lifecycle. Route: POST /payout/dodo/webhook.
 *
 * Intentionally unauthenticated (like the Stripe webhook): Dodo signs each
 * delivery per the Standard Webhooks spec and we verify that signature on the
 * raw body. This controller is the money-in authenticity boundary for the
 * Dodo rail, so a signature failure records NOTHING and returns 400 (A-107
 * parity — a mock that gates nothing was exactly that defect).
 *
 * Raw body parsing is mounted in main.ts for this route so the signature
 * verification sees the exact bytes Dodo signed.
 */
@ApiTags('Dodo Webhooks')
@Controller('payout/dodo')
export class DodoWebhookController implements OnModuleInit {
  private readonly logger = new Logger(DodoWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly eventBus: EventBus,
  ) {}

  onModuleInit() {
    // Reclaim path: WebhookReclaimCronService re-queues a stalled Dodo
    // delivery here from its stored payload. Dodo exposes no event-retrieval
    // API, so (unlike Stripe) the full event is retained at receipt time
    // rather than reconstructed by id.
    this.eventBus.on('dodo.webhook', (payload) => {
      const { event, webhookId } = payload as { event: DodoWebhookEvent; webhookId: string };
      return this.runReclaimProcessing(event, webhookId);
    });
  }

  /**
   * Re-process a previously received (and signature-verified) delivery from its
   * durable payload. Idempotent: the ledger writes are keyed by Dodo payment/
   * refund/dispute id, and the converge step leaves `pending_review` rows alone.
   */
  async runReclaimProcessing(event: DodoWebhookEvent, webhookId: string): Promise<void> {
    await this.processEvent(event, event.type ?? '', webhookId);
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'dodo', eventId: webhookId, processingStatus: 'pending' },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
  }

  private isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('DODO_API_KEY') && this.config.get<string>('DODO_WEBHOOK_SECRET'),
    );
  }

  @ApiOperation({ summary: 'Receive Dodo webhook' })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: RawBodyRequest) {
    if (!this.isConfigured()) {
      this.logger.warn('Dodo webhook received but Dodo is not configured');
      // 2xx here would tell Dodo the event was accepted when it was not —
      // fail closed with 503 (A-062 parity).
      throw new HttpException(
        { received: false, reason: 'dodo_not_configured' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const webhookId = (req.headers['webhook-id'] as string | undefined) ?? '';
    const webhookSignature = (req.headers['webhook-signature'] as string | undefined) ?? '';
    const webhookTimestamp = (req.headers['webhook-timestamp'] as string | undefined) ?? '';
    if (!webhookId || !webhookSignature || !webhookTimestamp) {
      this.logger.warn('Dodo webhook missing one or more Standard Webhooks headers');
      throw new HttpException(
        { received: false, reason: 'missing_signature' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const rawBody =
      req.rawBody ??
      (Buffer.isBuffer(req.body) || typeof req.body === 'string' ? req.body : undefined);
    if (!rawBody) {
      this.logger.error('Dodo webhook missing raw body — raw-body middleware not mounted');
      throw new HttpException(
        { received: false, reason: 'missing_raw_body' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const secret = this.config.get<string>('DODO_WEBHOOK_SECRET', '');
    const verified = verifyStandardWebhookSignature({
      payload: rawBody,
      secret,
      headers: {
        'webhook-id': webhookId,
        'webhook-signature': webhookSignature,
        'webhook-timestamp': webhookTimestamp,
      },
    });
    if (!verified) {
      this.logger.error('Dodo webhook signature verification failed');
      // A bad signature is not a genuine Dodo event: 400 (not 2xx) stops Dodo
      // from re-delivering an event we can never process, and does NOT
      // acknowledge a (potentially money-moving) event we did not verify.
      throw new HttpException(
        { received: false, reason: 'signature_verification_failed' },
        HttpStatus.BAD_REQUEST,
      );
    }

    let event: DodoWebhookEvent;
    try {
      event = JSON.parse(
        Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody,
      ) as DodoWebhookEvent;
    } catch {
      this.logger.error('Dodo webhook body is not valid JSON');
      throw new HttpException({ received: false, reason: 'invalid_json' }, HttpStatus.BAD_REQUEST);
    }

    const eventType = event.type ?? '';
    if (!eventType) {
      this.logger.error('Dodo webhook payload has no event type');
      throw new HttpException(
        { received: false, reason: 'missing_event_type' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Persist a minimized payload (id/type/data ids + raw SHA-256) rather than
    // the full event. The full Dodo payload is never stored; the raw hash
    // corroborates the signature and only triage-relevant fields are kept.
    const rawHash = createHash('sha256')
      .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody))
      .digest('hex');
    const dataObject = (event.data ?? {}) as Record<string, unknown>;
    const minimizedPayload = {
      id: webhookId,
      type: eventType,
      paymentId: stringifyOrNull(dataObject.payment_id),
      refundId: stringifyOrNull(dataObject.refund_id),
      payoutId: stringifyOrNull(dataObject.payout_id),
      status: stringifyOrNull(dataObject.status),
      rawHash,
      // Retain the full event so WebhookReclaimCronService can re-process a
      // stalled delivery from durable storage (Dodo has no event-retrieval API).
      event,
    };
    assertSafeJson(minimizedPayload, `dodo.${webhookId}`);

    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'dodo',
          eventId: webhookId,
          eventType,
          payload: minimizedPayload as unknown as Prisma.InputJsonValue,
          processingStatus: 'pending',
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        // Same delivery id recorded twice (a network duplicate, or a crash
        // between persist and the 200). Re-process idempotently rather than
        // acknowledging a row that may still be 'pending'.
        this.logger.warn(`Dodo webhook ${webhookId} already recorded — re-processing`);
        await this.runReclaimProcessing(event, webhookId);
        return { received: true, reason: 'reprocessed' };
      }
      this.logger.error(`Failed to persist Dodo webhook ${webhookId}: ${getErrorMessage(err)}`);
      throw err;
    }

    // Process synchronously. A 2xx is returned only after reconciliation and
    // the audit record have committed; on failure we reset to 'pending' so
    // Dodo's retry can reprocess.
    try {
      await this.processEvent(event, eventType, webhookId);
    } catch (err: unknown) {
      this.logger.error(`Processing failed for Dodo event ${eventType}: ${getErrorMessage(err)}`);
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'dodo', eventId: webhookId, processingStatus: 'pending' },
        data: { processingStatus: 'pending' },
      });
      throw new HttpException(
        { received: false, reason: 'processing_failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Only converge a row the handler left `pending`. Handlers that route an
    // event to `pending_review` (refund/dispute overlap, advertiser not found,
    // unhandled types) keep that review state — this updateMany must not
    // overwrite it.
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'dodo', eventId: webhookId, processingStatus: 'pending' },
      data: { processingStatus: 'processed', processedAt: new Date() },
    });
    return { received: true };
  }

  private async processEvent(
    event: DodoWebhookEvent,
    eventType: string,
    webhookId: string,
  ): Promise<void> {
    switch (eventType) {
      case 'payment.succeeded':
        await this.handlePaymentSuccess(event, webhookId);
        return;
      case 'refund.succeeded':
        await this.handleRefundSucceeded(event, webhookId);
        return;
      case 'dispute.opened':
        await this.handleDisputeOpened(event, webhookId);
        return;
      case 'dispute.won':
      case 'dispute.cancelled':
        await this.handleDisputeResolved(event, webhookId, 'won');
        return;
      case 'dispute.lost':
      case 'dispute.accepted':
        await this.handleDisputeResolved(event, webhookId, 'lost');
        return;
      case 'payment.processing':
      case 'payment.failed':
      case 'payment.cancelled':
      case 'refund.failed':
      case 'refund.pending':
      case 'refund.review':
      case 'dispute.challenged':
        // Expected lifecycle events that move no money and need no ledger
        // action. Acknowledged so the row converges to 'processed'.
        this.logger.log(`Dodo event ${eventType} — no ledger action required`);
        return;
      default:
        // Payouts, subscriptions, dispute.expired ("typically resolves against
        // you", not certain) and anything Dodo adds in the future are retained
        // under review so an operator can reconcile them — never silently
        // dropped, never silently mutated.
        this.logger.log(
          `Dodo event ${eventType} — no automatic handler; retaining for operator review`,
        );
        await this.prisma.webhookEvent.updateMany({
          where: { provider: 'dodo', eventId: webhookId },
          data: { processingStatus: 'pending_review', processedAt: null },
        });
        return;
    }
  }

  /**
   * Record a Dodo deposit in the advertiser ledger and mirror it on the
   * platform cash side. Idempotent by Dodo payment id, so a redelivered
   * `payment.succeeded` is a P2002 no-op on both ledger sides.
   *
   * NOTE (W1.3 / §8.5): the amount credited is the figure Dodo reports on the
   * payment (gross charged; platform absorbs MoR fees as COGS). The payment
   * payload field names and minor-vs-major units must be confirmed against a
   * live test webhook before `deposits.global` is enabled — the operator owns
   * that verification (§8.1).
   */
  private async handlePaymentSuccess(event: DodoWebhookEvent, webhookId: string): Promise<void> {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const paymentId = stringifyOrNull(data.payment_id) ?? stringifyOrNull(data.id);
    const advertiserId = extractAdvertiserId(data);
    const amountMinor = toBigIntOrNull(data.amount);
    const currency = stringifyOrNull(data.currency) ?? 'USD';

    if (!paymentId || !advertiserId || amountMinor === null || amountMinor <= 0n) {
      this.logger.error(
        `Dodo payment.succeeded missing payment_id/advertiserId/amount — retaining for review: ${JSON.stringify(
          { paymentId, advertiserId, amountMinor: amountMinor?.toString(), currency },
        )}`,
      );
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'dodo', eventId: webhookId },
        data: {
          processingStatus: 'pending_review',
          error: 'unresolvable_payment_payload',
        },
      });
      return;
    }

    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: advertiserId },
      include: { user: { select: { status: true } } },
    });
    if (!advertiser) {
      this.logger.error(`Advertiser ${advertiserId} not found for Dodo payment ${paymentId}`);
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'dodo', eventId: webhookId },
        data: { processingStatus: 'pending_review', error: 'advertiser_not_found' },
      });
      return;
    }
    if (advertiser.user.status !== 'active') {
      // Cash received, but the owner is restricted/deleted. Record the real
      // cash receipt on the platform side and route to operator refund review
      // without granting spendable credit (Stripe parity).
      await this.prisma.platformLedger.upsert({
        where: { idempotencyKey: `dodo_deposit_plat_${paymentId}` },
        create: {
          entryType: 'credit',
          status: 'confirmed',
          amountMinor,
          currency: currency.toUpperCase(),
          bucket: 'cash',
          referenceId: paymentId,
          idempotencyKey: `dodo_deposit_plat_${paymentId}`,
          description: `Orphaned Dodo deposit awaiting refund review — payment ${paymentId}`,
        },
        update: {},
      });
      await this.audit.logStrict({
        actorId: 'dodo_webhook',
        actorRole: 'system',
        action: 'dodo_deposit_refund_required',
        targetType: 'advertiser',
        targetId: advertiser.id,
        beforeSnap: {
          paymentId,
          amountMinor: String(amountMinor),
          currency,
          userStatus: advertiser.user.status,
        },
      });
      await this.prisma.webhookEvent.updateMany({
        where: { provider: 'dodo', eventId: webhookId },
        data: {
          processingStatus: 'processed',
          processedAt: new Date(),
          error: 'advertiser_inactive_refund_required',
        },
      });
      return;
    }

    // Advertiser credit — idempotent by Dodo payment id. The payment id is
    // stored in `dodoPaymentId` so the refund/dispute handlers can locate the
    // deposit without re-scanning by amount (Stripe parity).
    const idempotencyKey = `dodo_deposit_${paymentId}`;
    try {
      await this.prisma.advertiserLedger.create({
        data: {
          advertiserId: advertiser.id,
          dodoPaymentId: paymentId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor,
          currency: currency.toUpperCase(),
          idempotencyKey,
          description: `Dodo deposit — payment ${paymentId}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(`Duplicate deposit for Dodo payment ${paymentId} — skipping`);
      } else {
        throw err;
      }
    }

    // Platform-side cash double-entry — idempotent by payment id.
    try {
      await this.prisma.platformLedger.create({
        data: {
          entryType: 'credit',
          status: 'confirmed',
          amountMinor,
          currency: currency.toUpperCase(),
          bucket: 'cash',
          referenceId: paymentId,
          idempotencyKey: `dodo_deposit_plat_${paymentId}`,
          description: `Dodo deposit cash received — payment ${paymentId}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) === 'P2002') {
        this.logger.warn(`Duplicate platform cash entry for Dodo payment ${paymentId} — skipping`);
      } else {
        throw err;
      }
    }

    // A-019 parity: activate campaigns approved while unfunded. The UPDATE is
    // naturally idempotent (a redelivered webhook re-activates nothing).
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
              WHEN "entryType" = 'refund' AND "status" = 'confirmed'
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
        `Activated ${activatedCount} previously-unfunded campaign(s) after Dodo deposit for advertiser ${advertiser.id}`,
      );
    }

    this.logger.log(
      `Recorded Dodo deposit: ${amountMinor} ${currency} for advertiser ${advertiser.id}`,
    );

    await this.audit.logStrict({
      actorId: 'dodo_webhook',
      actorRole: 'system',
      action: 'dodo_deposit',
      targetType: 'advertiser',
      targetId: advertiser.id,
      beforeSnap: {
        amountMinor: String(amountMinor),
        currency,
        paymentId,
      },
    });
  }

  /**
   * Reverse advertiser credit when Dodo reports a refund succeeded. Mirrors the
   * Stripe refund handler's invariants: idempotent per (payment, refund, entry),
   * one platform-cash refund per Dodo refund, and the advertiser side reverses
   * only the undisputed remainder of the deposit.
   */
  private async handleRefundSucceeded(event: DodoWebhookEvent, webhookId: string): Promise<void> {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const refundId = stringifyOrNull(data.refund_id) ?? stringifyOrNull(data.id);
    const paymentId = stringifyOrNull(data.payment_id);
    const amountMinor = toBigIntOrNull(data.amount);
    const currency = stringifyOrNull(data.currency) ?? 'USD';

    if (!refundId || !paymentId || amountMinor === null || amountMinor <= 0n) {
      this.logger.error(
        `Dodo refund.succeeded missing refund_id/payment_id/amount — retaining for review`,
      );
      await this.retainForReview(webhookId, 'unresolvable_refund_payload');
      return;
    }

    // Platform-side cash double-entry — ONE refund row per Dodo refund,
    // idempotent on (paymentId, refundId), written regardless of whether an
    // advertiser credit exists to reverse (Dodo moved money out).
    const platKey = `dodo_refund_plat_${paymentId}_${refundId}`;
    try {
      await this.prisma.platformLedger.create({
        data: {
          entryType: 'refund',
          status: 'confirmed',
          amountMinor,
          currency: currency.toUpperCase(),
          bucket: 'cash',
          referenceId: paymentId,
          idempotencyKey: platKey,
          description: `Dodo refund cash returned — refund ${refundId}`,
        },
      });
    } catch (err: unknown) {
      if (getErrorCode(err) !== 'P2002') throw err;
      this.logger.warn(`Duplicate platform refund for ${platKey} — skipping`);
    }

    // A refund overlapping an open dispute is a money-sensitive edge case
    // (the disputed slice must be restored before it can be reversed). Route
    // it to operator review rather than guessing the interaction.
    const activeHolds = await this.prisma.advertiserLedger.findMany({
      where: {
        dodoPaymentId: paymentId,
        entryType: 'hold',
        status: 'held',
      },
      select: { id: true },
      take: 1,
    });
    if (activeHolds.length > 0) {
      this.logger.warn(
        `Dodo refund ${refundId} overlaps an open dispute hold on payment ${paymentId} — retaining for review`,
      );
      await this.retainForReview(webhookId, 'refund_overlaps_dispute');
      return;
    }

    // Reverse the active (undisputed) deposit credits for this payment.
    const entries = await this.prisma.advertiserLedger.findMany({
      where: {
        dodoPaymentId: paymentId,
        entryType: 'credit',
        status: { notIn: ['reversed', 'void'] },
        dodoDisputeId: null,
      },
    });

    if (entries.length === 0) {
      this.logger.warn(
        `No active ledger entries for Dodo payment ${paymentId} in refund ${refundId} — cash side recorded, advertiser side skipped`,
      );
      await this.audit.logStrict({
        actorId: 'dodo_webhook',
        actorRole: 'system',
        action: 'dodo_refund_orphan_advertiser',
        targetType: 'payment',
        targetId: paymentId,
        beforeSnap: { amountMinor: String(amountMinor), currency, refundId },
      });
      return;
    }

    let remaining = amountMinor;
    for (const entry of entries) {
      if (remaining <= 0n) break;
      const reversalAmount = entry.amountMinor < remaining ? entry.amountMinor : remaining;
      remaining -= reversalAmount;
      const idempotencyKey = `dodo_refund_${paymentId}_${refundId}_${entry.id}`;
      try {
        await this.prisma.advertiserLedger.create({
          data: {
            advertiserId: entry.advertiserId,
            campaignId: entry.campaignId,
            dodoPaymentId: paymentId,
            entryType: 'refund',
            status: 'confirmed',
            amountMinor: reversalAmount,
            currency: currency.toUpperCase(),
            idempotencyKey,
            description: `Refund for Dodo payment ${paymentId} — refund ${refundId}`,
          },
        });
      } catch (err: unknown) {
        if (getErrorCode(err) !== 'P2002') throw err;
        this.logger.warn(`Duplicate refund entry for ${idempotencyKey} — skipping`);
      }
    }

    this.logger.log(
      `Refund processed: Dodo payment=${paymentId}, amount=${amountMinor} ${currency}`,
    );
    await this.audit.logStrict({
      actorId: 'dodo_webhook',
      actorRole: 'system',
      action: 'dodo_refund',
      targetType: 'payment',
      targetId: paymentId,
      beforeSnap: { amountMinor: String(amountMinor), currency, refundId },
    });
  }

  /**
   * Freeze the disputed slice of a deposit: decrement the parent credit row by
   * the held amount and record a `hold` row (status `held`) stamped with the
   * dispute id. The balance formula ignores `held` rows, so the net effect is
   * the disputed amount stops being spendable (A-063 parity).
   */
  private async handleDisputeOpened(event: DodoWebhookEvent, webhookId: string): Promise<void> {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const disputeId = stringifyOrNull(data.dispute_id) ?? stringifyOrNull(data.id);
    const paymentId = stringifyOrNull(data.payment_id);
    // The dispute amount is serialized as a string by Dodo to preserve
    // precision; parse it as an exact minor-unit integer.
    const amountMinor = toBigIntOrNull(data.amount);
    const currency = stringifyOrNull(data.currency) ?? 'USD';

    if (!disputeId || !paymentId || amountMinor === null || amountMinor <= 0n) {
      this.logger.error(
        `Dodo dispute.opened missing dispute_id/payment_id/amount — retaining for review`,
      );
      await this.retainForReview(webhookId, 'unresolvable_dispute_payload');
      return;
    }

    const entries = await this.prisma.advertiserLedger.findMany({
      where: {
        dodoPaymentId: paymentId,
        entryType: 'credit',
        status: { notIn: ['reversed', 'void'] },
        dodoDisputeId: null,
      },
    });
    if (entries.length === 0) {
      this.logger.error(
        `Dodo dispute ${disputeId} has no active deposit credit on payment ${paymentId} — retaining for review`,
      );
      await this.retainForReview(webhookId, 'dispute_without_deposit');
      return;
    }

    let remaining = amountMinor;
    for (const entry of entries) {
      if (remaining <= 0n) break;
      const heldAmount = entry.amountMinor < remaining ? entry.amountMinor : remaining;
      remaining -= heldAmount;
      await this.prisma.$transaction(async (tx) => {
        await tx.advertiserLedger.updateMany({
          where: { id: entry.id, status: { notIn: ['reversed', 'void'] } },
          data: { amountMinor: { decrement: heldAmount } },
        });
        await tx.advertiserLedger.create({
          data: {
            advertiserId: entry.advertiserId,
            campaignId: entry.campaignId,
            dodoPaymentId: paymentId,
            dodoDisputeId: disputeId,
            entryType: 'hold',
            status: 'held',
            amountMinor: heldAmount,
            currency: currency.toUpperCase(),
            idempotencyKey: `dodo_dispute_hold_${disputeId}_${entry.id}`,
            description: `Dodo dispute hold — dispute ${disputeId}`,
          },
        });
      });
    }

    this.logger.log(
      `Dodo dispute hold recorded: dispute=${disputeId}, payment=${paymentId}, amount=${amountMinor} ${currency}`,
    );
    await this.audit.logStrict({
      actorId: 'dodo_webhook',
      actorRole: 'system',
      action: 'dodo_dispute_opened',
      targetType: 'payment',
      targetId: paymentId,
      beforeSnap: { amountMinor: String(amountMinor), currency, disputeId },
    });
  }

  /**
   * Settle a dispute that reached a terminal state. `won`/`cancelled` restores
   * the held slice as a fresh confirmed credit; `lost`/`accepted` writes it off
   * as a confirmed refund (money returned to the cardholder) and mirrors the
   * platform-cash outflow. The hold row is retired (status `reversed`) inside
   * the same transaction so a redelivery cannot double-settle it.
   */
  private async handleDisputeResolved(
    event: DodoWebhookEvent,
    webhookId: string,
    outcome: 'won' | 'lost',
  ): Promise<void> {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const disputeId = stringifyOrNull(data.dispute_id) ?? stringifyOrNull(data.id);
    if (!disputeId) {
      this.logger.error('Dodo dispute resolution missing dispute_id — retaining for review');
      await this.retainForReview(webhookId, 'unresolvable_dispute_payload');
      return;
    }

    const holds = await this.prisma.advertiserLedger.findMany({
      where: { dodoDisputeId: disputeId, entryType: 'hold', status: 'held' },
    });

    let total = 0n;
    for (const hold of holds) {
      total += hold.amountMinor;
      await this.prisma.$transaction(async (tx) => {
        if (outcome === 'won') {
          await tx.advertiserLedger.create({
            data: {
              advertiserId: hold.advertiserId,
              campaignId: hold.campaignId,
              dodoPaymentId: hold.dodoPaymentId,
              dodoDisputeId: disputeId,
              entryType: 'credit',
              status: 'confirmed',
              amountMinor: hold.amountMinor,
              currency: hold.currency,
              idempotencyKey: `dodo_dispute_restore_${disputeId}_${hold.id}`,
              description: `Dodo dispute ${outcome} restore — dispute ${disputeId}`,
            },
          });
        } else {
          await tx.advertiserLedger.create({
            data: {
              advertiserId: hold.advertiserId,
              campaignId: hold.campaignId,
              dodoPaymentId: hold.dodoPaymentId,
              dodoDisputeId: disputeId,
              entryType: 'refund',
              status: 'confirmed',
              amountMinor: hold.amountMinor,
              currency: hold.currency,
              idempotencyKey: `dodo_dispute_writeoff_${disputeId}_${hold.id}`,
              description: `Dodo dispute ${outcome} write-off — dispute ${disputeId}`,
            },
          });
        }
        await tx.advertiserLedger.updateMany({
          where: { id: hold.id, status: 'held' },
          data: { status: 'reversed' },
        });
      });
    }

    // For a write-off the money physically returned to the cardholder: mirror
    // the platform-cash outflow once per dispute, idempotent by dispute id.
    if (outcome === 'lost' && holds.length > 0) {
      const currency = holds[0].currency;
      try {
        await this.prisma.platformLedger.create({
          data: {
            entryType: 'refund',
            status: 'confirmed',
            amountMinor: total,
            currency,
            bucket: 'cash',
            referenceId: disputeId,
            idempotencyKey: `dodo_dispute_plat_${disputeId}`,
            description: `Dodo dispute ${outcome} cash returned — dispute ${disputeId}`,
          },
        });
      } catch (err: unknown) {
        if (getErrorCode(err) !== 'P2002') throw err;
        this.logger.warn(`Duplicate platform dispute write-off for ${disputeId} — skipping`);
      }
    }

    this.logger.log(`Dodo dispute ${disputeId} settled as ${outcome} (${total} minor units)`);
    await this.audit.logStrict({
      actorId: 'dodo_webhook',
      actorRole: 'system',
      action: `dodo_dispute_${outcome}`,
      targetType: 'dispute',
      targetId: disputeId,
      beforeSnap: { amountMinor: String(total) },
    });
  }

  /** Retain an event for operator review and stop the request from retrying. */
  private async retainForReview(webhookId: string, error: string): Promise<void> {
    await this.prisma.webhookEvent.updateMany({
      where: { provider: 'dodo', eventId: webhookId },
      data: { processingStatus: 'pending_review', processedAt: null, error },
    });
  }
}

/** A Dodo webhook payload: `{ type, data, ... }` (Standard Webhooks body). */
interface DodoWebhookEvent {
  type?: string;
  id?: string;
  data?: Record<string, unknown>;
}

function stringifyOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function toBigIntOrNull(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/** Advertiser id is carried through checkout metadata; read it defensively. */
function extractAdvertiserId(data: Record<string, unknown>): string | null {
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  return (
    stringifyOrNull(metadata.advertiserId) ??
    stringifyOrNull(metadata.advertiser_id) ??
    stringifyOrNull(data.advertiserId) ??
    stringifyOrNull(data.advertiser_id)
  );
}
