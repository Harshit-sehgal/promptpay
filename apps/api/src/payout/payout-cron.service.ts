import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { PayoutStatus } from '@waitlayer/shared';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { acquireCronLease } from '../common/utils/cron-lease';
import {
  decryptPayoutDestination,
  isEncryptedDestination,
} from '../common/utils/payout-encryption';
import { providerBreaker, withTimeout } from '../common/utils/provider-resilience';
import { PrismaService } from '../config/prisma.service';
import { AlertsService } from '../observability/alerts.service';
import { MetricsService } from '../observability/metrics.service';
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
/**
 * Provider statuses that mean "initiated but not yet resolved to a terminal
 * state" for reconciliation purposes. These are ambiguous-initiation states
 * (e.g. `initiate_pending_*`, `requires_review`) plus the standard
 * `processing` state. The poll loop retains the payout fence for these and
 * relies on escalation-by-age (P1.10) to flag long-stuck payouts.
 */
const AMBIGUOUS_RECONCILIATION_STATUSES = new Set<string>([
  'processing',
  'initiate_pending',
  'pending_initiation',
  'requires_review',
]);
/**
 * A narrow subset of `AMBIGUOUS_RECONCILIATION_STATUSES` that represents a
 * TRUE ambiguous initiation — a provider-reported status meaning "started but
 * its outcome is genuinely unresolved" (e.g. `initiate_pending`,
 * `pending_initiation`, `requires_review`). Plain `processing` is excluded: it
 * is the routine in-flight state and would be noisy to alert on every poll.
 * When the provider reports one of these for a processing payout we surface a
 * dedicated ambiguous-outcome alert (P1.25).
 */
const AMBIGUOUS_INITIATION_ALERT_STATUSES = new Set<string>([
  'initiate_pending',
  'pending_initiation',
  'requires_review',
]);

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
  /** A `processing` payout older than this is escalated for manual review (P1.10). */
  private readonly ESCALATION_AGE_MS = Number(
    process.env.PAYOUT_ESCALATION_AGE_MS ?? 24 * 60 * 60 * 1000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutService: PayoutService,
    private readonly referral: ReferralService,
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
  ) {}

  async onApplicationBootstrap() {
    if (!backgroundJobsEnabled()) return;
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
      // `markPayoutPaid`'s amount/currency cross-check (self-check): the
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
        const processedAt = payout.processedAt;
        const FENCE_AGE_THRESHOLD_MS = Number(
          process.env.PAYOUT_FENCE_ALERT_AGE_MS ?? 30 * 60 * 1000,
        );
        const ageMs = processedAt ? Date.now() - processedAt.getTime() : 0;

        // Fence-age alert (existing P1.25 behaviour).
        if (ageMs > FENCE_AGE_THRESHOLD_MS) {
          this.metrics.recordRetainedPayoutFence();
          this.alerts.alertPayoutFenceAge({ payoutId: payout.id, ageMs });
        }

        const providerTxId = payout.transactions[0]?.providerTxId ?? undefined;
        const escalateNow = ageMs > this.ESCALATION_AGE_MS && payout.escalatedAt == null;
        if (escalateNow) {
          this.alerts.alertPayoutEscalation({
            payoutId: payout.id,
            ageMs,
            reason: providerTxId ? 'still_processing' : 'no_provider_txid',
          });
        }

        // Per-payout reconciliation-attempt accumulator (P1.10). A local
        // accumulator keeps multiple attempts within a single poll
        // append-correctly and durably — the previous implementation re-read the
        // stale original log on every call, so a second in-iteration attempt
        // would overwrite the first.
        const attempts: Prisma.JsonArray = Array.isArray(payout.reconciliationLog)
          ? [...(payout.reconciliationLog as Prisma.JsonArray)]
          : [];
        const recordAttempt = async (attemptOutcome: string): Promise<void> => {
          attempts.push({ at: new Date().toISOString(), outcome: attemptOutcome });
          const capped = attempts.slice(-20);
          await this.prisma.payoutRequest.update({
            where: { id: payout.id },
            data: {
              reconciliationAttempts: { increment: 1 },
              lastReconciliationAt: new Date(),
              reconciliationLog: capped,
              ...(escalateNow ? { escalatedAt: new Date() } : {}),
            },
          });
        };

        if (!providerTxId) {
          // Ambiguous initiation: no provider transaction id was captured at
          // request time. Attempt reconciliation by our platform-controlled
          // external reference (payoutRequestId) when the provider supports it
          // (P1.10). If the provider resolves the payout we act immediately.
          const refProvider = this.payoutService.getProvider(payout.payoutAccount.provider);
          const refFn = refProvider?.checkStatusByReference;
          if (refFn) {
            try {
              const refStatus = await providerBreaker.call(
                `checkStatusByRef:${payout.payoutAccount.provider}`,
                () =>
                  withTimeout(
                    () =>
                      refFn(payout.id, {
                        destination: this.decryptDest(payout.payoutAccount.destination),
                      }),
                    `provider checkStatusByReference ${payout.payoutAccount.provider}`,
                  ),
              );
              if (refStatus?.status === 'paid') {
                this.logger.log(
                  `Payout ${payout.id} resolved as paid via external-reference lookup — auto-completing`,
                );
                await this.payoutService.markPayoutPaid(payout.id, {
                  providerTxId: undefined,
                  paidAt: (refStatus.paidAt ?? new Date()).toISOString(),
                  expectedAmountMinor: payout.approvedAmountMinor ?? payout.requestedAmountMinor,
                  expectedCurrency: payout.currency,
                });
                completed++;
                await recordAttempt('ref_paid');
                continue;
              }
              if (refStatus?.status === 'failed') {
                this.logger.warn(
                  `Payout ${payout.id} resolved as failed via external-reference lookup — marking failed`,
                );
                await this.payoutService.markPayoutFailed(payout.id, {
                  provider: payout.payoutAccount.provider,
                  providerTxId: undefined,
                  failureReason: 'Provider reported failure via external-reference status poll',
                });
                failedCount++;
                await recordAttempt('ref_failed');
                continue;
              }
            } catch {
              // Reference lookup unsupported/errored — fall through to the
              // normal provider status poll below.
            }
          }
          // Ambiguous initiation with no successful external-reference
          // resolution: record the attempt (for audit/escalation history) and
          // STILL poll the provider via checkStatus using the platform
          // reference. A processing payout must always be reconciled — the
          // original behaviour polled every processing payout, and providers
          // such as `paypal_email`/`manual` report status by external reference
          // even without a captured transaction id. This fixes the regression
          // where no-providerTxId payouts were silently skipped (P1.10).
          this.logger.warn(
            `Payout ${payout.id} is in processing status but has no provider transaction — recorded reconciliation attempt${escalateNow ? ' and escalated for manual review' : ''}`,
          );
          await recordAttempt('no_provider_txid');
          // NOTE: intentionally no `continue` — fall through to the provider
          // checkStatus poll so the payout is still reconciled.
        }

        const provider = this.payoutService.getProvider(payout.payoutAccount.provider);
        if (!provider) {
          this.logger.warn(
            `Provider "${payout.payoutAccount.provider}" for payout ${payout.id} is not available — skipping`,
          );
          await recordAttempt('provider_unavailable');
          continue;
        }

        checked++;

        try {
          const status = await providerBreaker.call(
            `checkStatus:${payout.payoutAccount.provider}`,
            () =>
              withTimeout(
                () =>
                  provider.checkStatus(providerTxId ?? payout.id, {
                    destination: this.decryptDest(payout.payoutAccount.destination),
                    externalReference: payout.id,
                  }),
                `provider checkStatus ${payout.payoutAccount.provider}`,
              ),
          );

          if (status.status === 'paid') {
            this.logger.log(
              `Payout ${payout.id} (${payout.payoutAccount.provider}:${providerTxId}) is confirmed paid — auto-completing`,
            );
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
          } else if (AMBIGUOUS_RECONCILIATION_STATUSES.has(status.status)) {
            this.logger.log(
              `Payout ${payout.id} in ambiguous reconciliation status "${status.status}" — retaining fence`,
            );
            // Only a TRUE ambiguous initiation (not routine `processing`) is
            // worth alerting on — see AMBIGUOUS_INITIATION_ALERT_STATUSES. The
            // existing cooldown dedupe in AlertsService suppresses per-poll
            // noise for the same payout.
            if (AMBIGUOUS_INITIATION_ALERT_STATUSES.has(status.status)) {
              this.alerts.alertAmbiguousPayoutOutcome({
                payoutId: payout.id,
                provider: payout.payoutAccount.provider,
                status: status.status,
                reason: 'unresolved_ambiguous_initiation',
              });
            }
          }
          await recordAttempt(status.status);
        } catch (err) {
          this.logger.error(
            `Failed to check status for payout ${payout.id} (${providerTxId}): ${err instanceof Error ? err.message : err}`,
          );
          // Provider-failure spike detection (P1.25): record the failure and
          // alert only once the rolling 15-minute count crosses the threshold.
          // Alerting must never mask the underlying provider error.
          try {
            const count = this.alerts.recordRate(
              'provider_failure',
              payout.payoutAccount.provider,
              15 * 60 * 1000,
            );
            if (count >= 5) {
              this.alerts.alertProviderFailureRate({
                provider: payout.payoutAccount.provider,
                count,
                windowMs: 900_000,
              });
            }
          } catch {
            // alerting failure must not mask the underlying provider error
          }
          await recordAttempt('error');
          // Don't throw — let the cron continue to other payouts
        }
      }

      if (checked > 0) {
        this.logger.log(
          `Payout poll complete: checked=${checked}, completed=${completed}, failed=${failedCount}`,
        );
      }
      this.metrics.increment('payout_poll_checked', checked);
      this.metrics.increment('payout_poll_completed', completed);
      this.metrics.increment('payout_poll_failed', failedCount);
      return { checked, completed, failed: failedCount };
    } catch (err) {
      this.logger.error(`Payout polling cron failed: ${err instanceof Error ? err.message : err}`);
      return { checked: 0, completed: 0, failed: 0 };
    } finally {
      this.pollInFlight = false;
    }
  }

  /**
   * Decrypt the stored payout destination. Legacy destinations stored before
   * encryption was introduced have no 'v1:' prefix and are passed through as-is.
   */
  private decryptDest(destination: string): string {
    return isEncryptedDestination(destination)
      ? decryptPayoutDestination(destination)
      : destination;
  }
}
