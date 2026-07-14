import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { PayoutStatus } from '@waitlayer/shared';

import { acquireCronLease } from '../common/utils/cron-lease';
import { providerBreaker, withTimeout } from '../common/utils/provider-resilience';
import { PrismaService } from '../config/prisma.service';
import { ReferralService } from '../referral/referral.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import { boundedPositiveInt } from './payout.constants';
import { PayoutService } from './payout.service';

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
  private readonly ownerId = randomUUID();
  // Configurable via PAYOUT_POLL_INTERVAL_MS (default 10 minutes).
  private readonly POLL_INTERVAL_MS = Number(process.env.PAYOUT_POLL_INTERVAL_MS ?? 600_000);
  /** Skip payouts processed within the last N ms (anti-fast-poll) */
  private readonly STALL_THRESHOLD_MS = 120_000; // 2 minutes
  private readonly BATCH_SIZE = boundedPositiveInt(
    Number(process.env.PAYOUT_POLL_BATCH_SIZE),
    100,
    500,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutService: PayoutService,
    private readonly referral: ReferralService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting payout status polling cron...');
    // Fire-and-forget startup poll. Provider calls can be slow; application
    // readiness should not depend on an external payout status check.
    void this.pollProcessingPayouts().catch((err: unknown) => {
      this.logger.error(`Payout startup poll failed: ${err instanceof Error ? err.message : err}`);
    });

    // Then poll on interval
    this.intervalId = setInterval(() => {
      void this.pollProcessingPayouts().catch((err: unknown) => {
        this.logger.error(
          `Payout interval poll failed: ${err instanceof Error ? err.message : err}`,
        );
      });
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
    if (!(await this.runtimeConfig.isAutoPayoutProcessingEnabled())) {
      this.logger.log('Automatic payout processing is disabled — skipping poll');
      return { checked: 0, completed: 0, failed: 0 };
    }
    if (this.pollInFlight) {
      this.logger.warn('Payout status polling already in flight — skipping overlapping poll');
      return { checked: 0, completed: 0, failed: 0 };
    }

    this.pollInFlight = true;
    const cutoff = new Date(Date.now() - this.STALL_THRESHOLD_MS);

    try {
      if (
        !(await acquireCronLease(
          this.prisma,
          'payout-status-poll',
          this.ownerId,
          Math.max(this.POLL_INTERVAL_MS - 1_000, 30_000),
        ))
      ) {
        return { checked: 0, completed: 0, failed: 0 };
      }
      // Durable retry for a paid payout whose referral side-effect failed
      // after the payout transaction committed.
      await this.referral.reconcilePendingReferralRewards(this.BATCH_SIZE);
      // Find processing payouts that were claimed at least STALL_THRESHOLD_MS ago
      // (avoid re-checking payouts that were just submitted by processPayout)
      // `approvedAmountMinor` and `currency` are selected specifically to feed
      // `markPayoutPaid`'s amount/currency cross-check (Round 27 Fix 2): the
      // admin DTO supplies these from the request body, but the cron has no
      // body — the next-best authoritative source is the stored values on the
      // PayoutRequest itself (the operator approved / requested them, so any
      // null / 0 / wrong-currency stored value is exactly the latent bug the
      // cross-check is meant to surface):
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
        orderBy: [{ processedAt: 'asc' }, { id: 'asc' }],
        take: this.BATCH_SIZE,
      });

      if (processingPayouts.length === 0) return { checked: 0, completed: 0, failed: 0 };

      this.logger.log(`Polling status for ${processingPayouts.length} processing payout(s)...`);

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
          // Wrap the external PSP status check in a timeout + circuit breaker
          // (per provider) so an unresponsive provider can't hang the poll
          // loop or be hammered while unhealthy.
          const status = await providerBreaker.call(
            `checkStatus:${payout.payoutAccount.provider}`,
            () =>
              withTimeout(
                () =>
                  provider.checkStatus(providerTxId, {
                    destination: payout.payoutAccount.destination,
                  }),
                `provider checkStatus ${payout.payoutAccount.provider}`,
              ),
          );

          if (status.status === 'paid') {
            this.logger.log(
              `Payout ${payout.id} (${payout.payoutAccount.provider}:${providerTxId}) is confirmed paid — auto-completing`,
            );

            // Round 27 Fix 2: pass the stored approved/requested amount +
            // currency as the cross-check fields so markPayoutPaid's
            // `expectedAmountMinor !== undefined` guard fires for the cron
            // path. The provider's checkStatus returns no amount (only
            // status + paidAt), so we cannot cross-check against the
            // provider — but we CAN self-check that the stored values are
            // coherent: caught null / 0 / wrong-currency would surface here
            // instead of silently flipping a payout to `paid`.
            await this.payoutService.markPayoutPaid(payout.id, {
              providerTxId,
              paidAt: (status.paidAt ?? new Date()).toISOString(),
              expectedAmountMinor: payout.approvedAmountMinor ?? payout.requestedAmountMinor,
              expectedCurrency: payout.currency,
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
      this.logger.error(`Payout polling cron failed: ${err instanceof Error ? err.message : err}`);
      return { checked: 0, completed: 0, failed: 0 };
    } finally {
      this.pollInFlight = false;
    }
  }
}
