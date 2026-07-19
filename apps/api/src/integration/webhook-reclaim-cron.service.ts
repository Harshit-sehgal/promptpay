import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { EventBus } from '../common/events/event-bus';
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

@Injectable()
export class WebhookReclaimCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebhookReclaimCronService.name);
  private intervalId?: NodeJS.Timeout;
  private reclaimInFlight = false;

  private readonly enabled =
    process.env.WEBHOOK_RECLAIM_CRON === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_RECLAIM_CRON !== 'false');
  private readonly POLL_INTERVAL_MS = Number(
    process.env.WEBHOOK_RECLAIM_CRON_INTERVAL_MS ?? 300_000,
  );
  // Older than this → eligible for reclaim. 35 min > controller's 30-min stall
  // window so the two recovery paths never target the same row concurrently.
  private readonly ORPHAN_AGE_MS = Number(
    process.env.WEBHOOK_RECLAIM_CRON_AGE_MS ?? 35 * 60 * 1_000,
  );
  private readonly BATCH_SIZE = Number(process.env.WEBHOOK_RECLAIM_CRON_BATCH_SIZE ?? 100);

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
        // The persisted webhookEvent row stores only a MINIMIZED payload
        // (id/type/created/dataObjectId/dataObjectStatus + SHA-256 rawHash),
        // not the full Stripe event. Reconstruct the complete event from Stripe
        // by id so runProcessing has the data.object it needs (P1.12).
        const eventId = (row.payload as { id?: string } | null)?.id;
        if (!eventId) {
          this.logger.warn(
            `Skipping webhook event ${row.id} (${row.eventId}) — minimized payload is missing an event id`,
          );
          continue;
        }
        const event = await this.stripe.getEvent(eventId);
        if (!event) {
          this.logger.warn(
            `Skipping webhook event ${row.id} (${row.eventId}) — could not retrieve event ${eventId} from Stripe`,
          );
          continue;
        }
        // Exact compare-and-set claim: another replica may have changed this
        // row after the scan. Only the winner dispatches the payload.
        const claim = await this.prisma.webhookEvent.updateMany({
          where: {
            id: row.id,
            processingStatus: row.processingStatus,
            updatedAt: row.updatedAt,
          },
          data: { processingStatus: 'pending' },
        });
        if (claim.count === 0) continue;
        // Re-run the controller's reconciliation handler via the shared bus.
        // The handler performs its own failure recovery (resets to 'pending' on
        // error) so a failed reprocessing stays reclaimable.
        await this.eventBus.dispatch(WEBHOOK_EVENT, { event });
        requeued++;
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
}
