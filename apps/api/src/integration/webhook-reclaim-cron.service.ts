import type Stripe from 'stripe';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { EventBus } from '../common/events/event-bus';
import { PrismaService } from '../config/prisma.service';

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
 * OPT-IN: disabled unless `WEBHOOK_RECLAIM_CRON === 'true'`. Default is OFF so
 * existing behaviour is unchanged and single-instance deployments don't double
 * process. Enable only in multi-instance / high-durability deployments where a
 * background worker should own orphan reclamation.
 */
const WEBHOOK_EVENT = 'stripe.webhook';

@Injectable()
export class WebhookReclaimCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebhookReclaimCronService.name);
  private intervalId?: NodeJS.Timeout;
  private reclaimInFlight = false;

  private readonly enabled = process.env.WEBHOOK_RECLAIM_CRON === 'true';
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
    void this.reclaimOrphanedWebhooks();
    this.intervalId = setInterval(() => {
      void this.reclaimOrphanedWebhooks();
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
        const event = row.payload as unknown as Stripe.Event | undefined;
        if (!event?.id) {
          this.logger.warn(
            `Skipping webhook event ${row.id} (${row.eventId}) — payload is missing or not a Stripe event`,
          );
          continue;
        }
        // Reset to 'pending' so the row's state reflects re-queueing and any
        // concurrent processor sees a clean claimable row.
        await this.prisma.webhookEvent.updateMany({
          where: {
            provider: row.provider,
            eventId: row.eventId,
            processingStatus: { in: ['pending', 'processing'] },
          },
          data: { processingStatus: 'pending' },
        });
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
