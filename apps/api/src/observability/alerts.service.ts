import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

import { MetricsService } from './metrics.service';

/**
 * Operational alert dispatcher (P1.25).
 *
 * Every alert is:
 *  - recorded as a metric (`alert{event=...}`) so dashboards can show rates;
 *  - logged at ERROR severity with a PII-free context;
 *  - forwarded to Sentry ONLY when a DSN is configured (no-op otherwise).
 *
 * The context is scrubbed before leaving the process: any key that looks like
 * a secret, token, PII field or payout destination is replaced with
 * `<redacted>`. This keeps the alert useful for operators without leaking
 * sensitive data into logs or Sentry.
 */
/** Default suppression window for duplicate alerts (same type+key), ms (15 min). */
const DEFAULT_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
export type AlertEvent =
  | 'ledger_discrepancy'
  | 'negative_advertiser_balance'
  | 'campaign_over_budget'
  | 'payout_paid_without_provider_tx'
  | 'payout_fence_age'
  | 'ambiguous_payout_outcome'
  | 'audit_dead_letter'
  | 'migration_failed'
  | 'backup_restore_failed'
  | 'wait_false_positive_spike'
  | 'ctr_impression_spike'
  | 'provider_failure_rate'
  | 'payout_escalation'
  | 'auth_identity_mismatch';

@Injectable()
export class AlertsService {
  /**
   * Last-sent timestamp (ms) per dedupe key (`type:key`). Drives the cooldown
   * suppression in `sendAlert`: an identical alert re-sent inside the cooldown
   * window is dropped.
   */
  private readonly lastSent = new Map<string, number>();
  /**
   * Sliding-window rate buckets keyed by `rate:<name>:<key>`. Each value is a
   * list of event timestamps; pruned lazily by `recordRate`. Used to detect
   * alert "spikes" (bursts of false-positive reports, anomalous CTRs, …).
   */
  private readonly rateWindows = new Map<string, number[]>();
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly metrics: MetricsService) {}

  alert(event: AlertEvent, ctx: Record<string, unknown> = {}): void {
    this.metrics.increment(`alert{event=${event}}`);
    const safe = this.scrub(ctx);
    this.logger.error(`[ALERT ${event}] ${JSON.stringify(safe)}`);
    if (process.env.SENTRY_DSN) {
      Sentry.captureMessage(`[ALERT] ${event}`, {
        level: 'error',
        extra: safe,
      });
    }
  }

  /**
   * Send an alert, suppressing identical alerts (same `type` + `key`) within a
   * cooldown window. Returns `true` if the alert was actually forwarded (and
   * the Sentry/metric side effects ran), or `false` if it was dropped as a
   * duplicate. The suppression window is configurable via `ALERT_COOLDOWN_MS`
   * and defaults to 15 minutes.
   *
   * All forwarding (metric increment, ERROR log, conditional Sentry) is
   * preserved — this only adds deduping on top of `alert`.
   */
  sendAlert(type: AlertEvent, key: string, payload: Record<string, unknown> = {}): boolean {
    const cooldownMs = Number(process.env.ALERT_COOLDOWN_MS ?? DEFAULT_ALERT_COOLDOWN_MS);
    const dedupeKey = `${type}:${key}`;
    const now = Date.now();
    const last = this.lastSent.get(dedupeKey);
    if (last !== undefined && now - last < cooldownMs) {
      return false;
    }
    this.lastSent.set(dedupeKey, now);
    this.alert(type, payload);
    return true;
  }

  /**
   * Record an occurrence of `name`+`key` and return how many occurrences fall
   * inside the trailing `windowMs` window (including this one). Buckets are
   * pruned lazily. Detection paths use this to turn a per-event anomaly into a
   * "spike" alert: when the returned count exceeds a threshold they call
   * `sendAlert` (which then dedupes by `key`).
   */
  recordRate(name: string, key: string, windowMs: number, now: number = Date.now()): number {
    const bucketKey = `rate:${name}:${key}`;
    const arr = (this.rateWindows.get(bucketKey) ?? []).filter((t) => t > now - windowMs);
    arr.push(now);
    this.rateWindows.set(bucketKey, arr);
    return arr.length;
  }

  private scrub(ctx: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx)) {
      if (/token|secret|password|cookie|key|pii|email|destination|amount/i.test(key)) {
        out[key] = '<redacted>';
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  // --- Semantic helpers (P1.25) ---
  alertLedgerDiscrepancy(ctx: Record<string, unknown> = {}): void {
    this.alert('ledger_discrepancy', ctx);
  }
  alertNegativeAdvertiserBalance(ctx: Record<string, unknown> = {}): void {
    this.alert('negative_advertiser_balance', ctx);
  }
  alertCampaignOverBudget(ctx: Record<string, unknown> = {}): void {
    this.alert('campaign_over_budget', ctx);
  }
  alertPayoutPaidWithoutProviderTx(ctx: Record<string, unknown> = {}): void {
    this.alert('payout_paid_without_provider_tx', ctx);
  }
  alertPayoutFenceAge(ctx: Record<string, unknown> = {}): void {
    this.alert('payout_fence_age', ctx);
  }
  alertAmbiguousPayoutOutcome(ctx: Record<string, unknown> = {}): void {
    this.alert('ambiguous_payout_outcome', ctx);
  }
  alertAuditDeadLetter(ctx: Record<string, unknown> = {}): void {
    this.alert('audit_dead_letter', ctx);
  }
  alertAuthIdentityMismatch(ctx: Record<string, unknown> = {}): void {
    this.alert('auth_identity_mismatch', ctx);
  }
  alertPayoutEscalation(ctx: Record<string, unknown> = {}): void {
    // Route through sendAlert so repeated escalations for the same payout are
    // deduped within the cooldown window (P1.25 dedupe). The payout cron also
    // guards with `escalatedAt`, so this is defence-in-depth.
    const key = typeof ctx.payoutId === 'string' ? `payout:${ctx.payoutId}` : 'payout:unknown';
    this.sendAlert('payout_escalation', key, ctx);
  }
  alertMigrationFailed(ctx: Record<string, unknown> = {}): void {
    this.alert('migration_failed', ctx);
  }
  alertProviderFailureRate(ctx: Record<string, unknown> = {}): void {
    this.alert('provider_failure_rate', ctx);
  }
}
