import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { EventBus } from '../common/events/event-bus';
import { envNumber } from '../common/utils/env-number';
import { PrismaService } from '../config/prisma.service';
import { StripeProvider } from '../payout/providers';

/**
 * Optional webhook-event reclaim worker (engineering hardening, issue A-062).
 *
 * The Stripe webhook receiver (StripeWebhookController) acknowledges an event
 * and processes it synchronously, leaving the webhookEvent row in `processing`.
 * On failure it resets the row to `pending` so the NEXT Stripe redelivery (or
 * the controller's own 30-minute stall-reclaim path) can reprocess it. That
 * recovery depends on Stripe retrying AND on the same process still running.
 *
 * This cron is an INDEPENDENT safety net: it periodically scans for
 * webhookEvent rows stuck in `pending`/`processing` for longer than a threshold
 * (default 35 minutes — deliberately just past the controller's 30-minute stall
 * window, so the two never fight over the same row) and re-queues them onto the
 * in-process EventBus, which re-runs the controller's reconciliation handler.
 *
 * Production-safe default: enabled in production unless explicitly set false;
 * non-production environments remain opt-in. The row-level compare-and-set
 * claim below prevents multiple replicas from dispatching the same orphan.
 */
const WEBHOOK_EVENT = 'stripe.webhook';
const DODO_WEBHOOK_EVENT = 'dodo.webhook';

/** Minimal row shape the reclaim loop needs from `webhookEvent.findMany`. */
interface ReclaimRow {
  id: string;
  provider: string;
  eventId: string;
  payload: unknown;
  processingStatus: string;
  updatedAt: Date;
}

@Injectable()
export class WebhookReclaimCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebhookReclaimCronService.name);
  private intervalId?: NodeJS.Timeout;
  private reclaimInFlight = false;

  private readonly enabled =
    process.env.WEBHOOK_RECLAIM_CRON === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_RECLAIM_CRON !== 'false');
  // Clamped so a malformed env value can never make setInterval fire in a
  // hot loop or make the age/batch filters behave adversarially.
  private readonly POLL_INTERVAL_MS = envNumber(
    'WEBHOOK_RECLAIM_CRON_INTERVAL_MS',
    300_000,
    60_000,
    86_400_000,
  );
  // Older than this → eligible for reclaim. 35 min > controller's 30-min stall
  // window so the two recovery paths never target the same row concurrently.
  private readonly ORPHAN_AGE_MS = envNumber(
    'WEBHOOK_RECLAIM_CRON_AGE_MS',
    35 * 60 * 1_000,
    60_000,
    2_592_000_000,
  );
  private readonly BATCH_SIZE = envNumber('WEBHOOK_RECLAIM_CRON_BATCH_SIZE', 100, 1, 1_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
    private readonly stripe: StripeProvider,
  ) {}

  onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log(
        'Webhook reclaim cron is DISABLED (set WEBHOOK_RECLAIM_CRON=true to enable).',
      );
      return;
    }
    this.logger.log(
      `Starting webhook reclaim cron (interval=${this.POLL_INTERVAL_MS}ms, orphanAge=${this.ORPHAN_AGE_MS}ms)...`,
    );
    void this.reclaimOrphanedWebhooks().catch((err: unknown) => {
      this.logger.error(
        `Webhook reclaim startup run failed: ${err instanceof Error ? err.message : err}`,
      );
    });
    this.intervalId = setInterval(() => {
      void this.reclaimOrphanedWebhooks().catch((err: unknown) => {
        this.logger.error(
          `Webhook reclaim interval failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, this.POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Webhook reclaim cron stopped.');
    }
  }

  /**
   * Scan for orphaned `pending`/`processing` webhook events and re-queue them
   * onto the EventBus so the StripeWebhookController's handler reprocesses them.
   */
  async reclaimOrphanedWebhooks(): Promise<{ found: number; requeued: number }> {
    if (!this.enabled) return { found: 0, requeued: 0 };
    if (this.reclaimInFlight) {
      this.logger.warn('Webhook reclaim already in flight — skipping overlapping run');
      return { found: 0, requeued: 0 };
    }

    this.reclaimInFlight = true;
    const cutoff = new Date(Date.now() - this.ORPHAN_AGE_MS);

    try {
      const orphans = await this.prisma.webhookEvent.findMany({
        where: {
          provider: { in: ['stripe', 'dodo'] },
          processingStatus: { in: ['pending', 'processing'] },
          updatedAt: { lt: cutoff },
        },
        orderBy: { updatedAt: 'asc' },
        take: this.BATCH_SIZE,
      });

      if (orphans.length === 0) return { found: 0, requeued: 0 };

      this.logger.log(`Found ${orphans.length} orphaned webhook event(s) to reclaim.`);
      let requeued = 0;
      for (const row of orphans) {
        requeued +=
          row.provider === 'dodo'
            ? await this.reclaimDodoRow(row)
            : await this.reclaimStripeRow(row);
      }

      if (requeued > 0) {
        this.logger.log(`Re-queued ${requeued} webhook event(s) for reprocessing.`);
      }
      return { found: orphans.length, requeued };
    } catch (err) {
      this.logger.error(`Webhook reclaim cron failed: ${err instanceof Error ? err.message : err}`);
      return { found: 0, requeued: 0 };
    } finally {
      this.reclaimInFlight = false;
    }
  }

  /**
   * Stripe rows are reconstructed from Stripe by id: the persisted payload is
   * minimized and cannot be re-processed on its own (P1.12). When Stripe is
   * deactivated at launch (D2, no STRIPE_SECRET_KEY) legacy rows cannot be
   * reconstructed, so they are skipped cleanly.
   */
  private async reclaimStripeRow(row: ReclaimRow): Promise<number> {
    if (!this.stripe.isEnabled()) return 0;
    const eventId = (row.payload as { id?: string } | null)?.id;
    if (!eventId) {
      this.logger.warn(
        `Skipping Stripe webhook event ${row.id} (${row.eventId}) — minimized payload is missing an event id`,
      );
      return 0;
    }
    const event = await this.stripe.getEvent(eventId);
    if (!event) {
      this.logger.warn(
        `Skipping Stripe webhook event ${row.id} (${row.eventId}) — could not retrieve event ${eventId} from Stripe`,
      );
      return 0;
    }
    if (!(await this.claimRow(row))) return 0;
    await this.eventBus.dispatch(WEBHOOK_EVENT, { event });
    return 1;
  }

  /**
   * Dodo rows re-process from the full event retained at receipt time (Dodo has
   * no event-retrieval API). The controller's `runReclaimProcessing` is
   * idempotent (ledger writes keyed by Dodo payment/refund/dispute id) and
   * converges the row.
   */
  private async reclaimDodoRow(row: ReclaimRow): Promise<number> {
    const event = (row.payload as { event?: unknown } | null)?.event;
    if (!event) {
      this.logger.warn(
        `Skipping Dodo webhook event ${row.id} (${row.eventId}) — stored payload has no full event`,
      );
      return 0;
    }
    if (!(await this.claimRow(row))) return 0;
    await this.eventBus.dispatch(DODO_WEBHOOK_EVENT, { event, webhookId: row.eventId });
    return 1;
  }

  /**
   * Exact compare-and-set claim: another replica may have changed this row
   * after the scan. Only the winner dispatches the payload.
   */
  private async claimRow(row: ReclaimRow): Promise<boolean> {
    const claim = await this.prisma.webhookEvent.updateMany({
      where: {
        id: row.id,
        processingStatus: row.processingStatus,
        updatedAt: row.updatedAt,
      },
      data: { processingStatus: 'pending' },
    });
    return claim.count > 0;
  }
}
