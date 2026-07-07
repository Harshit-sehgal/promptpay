import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { PayoutService } from './payout.service';
import { PayoutStatus } from '@waitlayer/shared';

/**
 * Payout status polling cron.
 *
 * Periodically polls payout providers (PayPal Payouts, Stripe Connect) for
 * in-flight payouts that are stuck in `processing` status and auto-completes
 * them (paid/failed) based on the provider's response.
 *
 * This closes the loop for providers that don't send webhook callbacks
 * (PayPal Payouts has no webhook, Stripe Connect uses webhooks handled by
 * StripeWebhookController). For providers with webhooks (Stripe Connect),
 * this cron acts as a safety net — polling catches any payouts that fell
 * through the webhook handler's retry window.
 *
 * Runs on application bootstrap and every 10 minutes thereafter.
 */
@Injectable()
export class PayoutCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PayoutCronService.name);
  private intervalId?: NodeJS.Timeout;
  private pollInFlight = false;
  private readonly POLL_INTERVAL_MS = 600_000; // 10 minutes
  /** Skip payouts processed within the last N ms (anti-fast-poll) */
  private readonly STALL_THRESHOLD_MS = 120_000; // 2 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutService: PayoutService,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting payout status polling cron...');
    // Fire-and-forget startup poll. Provider calls can be slow; application
    // readiness should not depend on an external payout status check.
    void this.pollProcessingPayouts();

    // Then poll on interval
    this.intervalId = setInterval(() => {
      this.pollProcessingPayouts();
    }, this.POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Payout status polling cron stopped.');
    }
  }

  /**
   * Find all processing payouts with a checkable provider and poll their status.
   */
  async pollProcessingPayouts(): Promise<{ checked: number; completed: number; failed: number }> {
    if (this.pollInFlight) {
      this.logger.warn('Payout status polling already in flight — skipping overlapping poll');
      return { checked: 0, completed: 0, failed: 0 };
    }

    this.pollInFlight = true;
    const cutoff = new Date(Date.now() - this.STALL_THRESHOLD_MS);

    try {
      // Find processing payouts that were claimed at least STALL_THRESHOLD_MS ago
      // (avoid re-checking payouts that were just submitted by processPayout)
      const processingPayouts = await this.prisma.payoutRequest.findMany({
        where: {
          status: PayoutStatus.PROCESSING,
          processedAt: { lte: cutoff },
        },
        include: {
          payoutAccount: true,
          transactions: {
            where: { status: 'processing' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (processingPayouts.length === 0) return { checked: 0, completed: 0, failed: 0 };

      this.logger.log(
        `Polling status for ${processingPayouts.length} processing payout(s)...`,
      );

      let checked = 0;
      let completed = 0;
      let failedCount = 0;

      for (const payout of processingPayouts) {
        const providerTxId = payout.transactions[0]?.providerTxId;
        if (!providerTxId) {
          this.logger.warn(
            `Payout ${payout.id} is in processing status but has no provider transaction — skipping`,
          );
          continue;
        }

        const provider = this.payoutService.getProvider(payout.payoutAccount.provider);
        if (!provider) {
          this.logger.warn(
            `Provider "${payout.payoutAccount.provider}" for payout ${payout.id} is not available — skipping`,
          );
          continue;
        }

        checked++;

        try {
          const status = await provider.checkStatus(providerTxId, {
            destination: payout.payoutAccount.destination,
          });

          if (status.status === 'paid') {
            this.logger.log(
              `Payout ${payout.id} (${payout.payoutAccount.provider}:${providerTxId}) is confirmed paid — auto-completing`,
            );

            await this.payoutService.markPayoutPaid(payout.id, {
              providerTxId,
              paidAt: (status.paidAt ?? new Date()).toISOString(),
            });

            completed++;
          } else if (status.status === 'failed') {
            this.logger.warn(
              `Payout ${payout.id} (${payout.payoutAccount.provider}:${providerTxId}) has failed — marking as failed`,
            );

            await this.payoutService.markPayoutFailed(payout.id, {
              provider: payout.payoutAccount.provider,
              providerTxId,
              failureReason: 'Provider reported failure via status poll',
            });

            failedCount++;
          }
          // If still processing, skip (will be picked up on next poll)
        } catch (err) {
          this.logger.error(
            `Failed to check status for payout ${payout.id} (${providerTxId}): ${err instanceof Error ? err.message : err}`,
          );
          // Don't throw — let the cron continue to other payouts
        }
      }

      if (checked > 0) {
        this.logger.log(
          `Payout poll complete: checked=${checked}, completed=${completed}, failed=${failedCount}`,
        );
      }

      return { checked, completed, failed: failedCount };
    } catch (err) {
      this.logger.error(
        `Payout polling cron failed: ${err instanceof Error ? err.message : err}`,
      );
      return { checked: 0, completed: 0, failed: 0 };
    } finally {
      this.pollInFlight = false;
    }
  }
}
