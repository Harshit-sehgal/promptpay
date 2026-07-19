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
  | 'auth_identity_mismatch';

@Injectable()
export class AlertsService {
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
}
