import { Injectable, Logger } from '@nestjs/common';

/**
 * Operational metrics sink.
 *
 * Lightweight, in-process counters/gauges covering the ad-serving, wait-
 * detection, money and reliability surfaces required by P1.24. It is
 * intentionally dependency-free (no external TSDB) so it cannot fail the
 * request path: every emit is a Map mutation.
 *
 * Durability & multi-replica: `toPrometheus()` exposes every metric in the
 * Prometheus text-exposition format so an external Prometheus can scrape it
 * (pull model) and build a durable time series, historical dashboards and
 * Alertmanager thresholds. Each replica exposes its own `/metrics`, labelled
 * by `instance`, so replicas no longer diverge silently and restarts no
 * longer reset the only copy.
 *
 * Monetary values are stored as `bigint` and never coerced to `number` at
 * emit time (the previous `Number(minor)` coercion silently lost precision
 * above 2^53 minor units). They are exact in `snapshot()` and rendered as
 * decimal strings to Prometheus; only Prometheus' own float64 limit applies
 * beyond 2^53, which is inherent to the scrape protocol, not a bug here.
 */
export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  /** Bigint monetary counters, stringified for JSON (exact, no precision loss). */
  moneyCounters?: Record<string, string>;
  /** Bigint monetary gauges, stringified for JSON (exact, no precision loss). */
  moneyGauges?: Record<string, string>;
  timestamp: string;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  // Bigint-safe monetary accumulators (P1.24). Exact in memory and in the
  // JSON snapshot; rendered as decimal strings to Prometheus. No silent
  // number coercion for monetary amounts.
  private readonly moneyCounters = new Map<string, bigint>();
  private readonly moneyGauges = new Map<string, bigint>();

  increment(name: string, by = 1): void {
    if (!Number.isFinite(by)) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setCounter(name: string, value: number): void {
    this.counters.set(name, value);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      moneyCounters: Object.fromEntries([...this.moneyCounters].map(([k, v]) => [k, v.toString()])),
      moneyGauges: Object.fromEntries([...this.moneyGauges].map(([k, v]) => [k, v.toString()])),
      timestamp: new Date().toISOString(),
    };
  }
  // --- Bigint-safe monetary helpers (P1.24) ---
  incrementMoney(name: string, by: bigint): void {
    if (typeof by !== 'bigint') return;
    this.moneyCounters.set(name, (this.moneyCounters.get(name) ?? 0n) + by);
  }

  gaugeMoney(name: string, value: bigint): void {
    if (typeof value !== 'bigint') return;
    this.moneyGauges.set(name, value);
  }

  getMoneyCounter(name: string): bigint {
    return this.moneyCounters.get(name) ?? 0n;
  }

  getMoneyGauge(name: string): bigint {
    return this.moneyGauges.get(name) ?? 0n;
  }

  /**
   * Render all metrics in Prometheus text-exposition format so an external
   * Prometheus can scrape this process (pull model) and build a durable time
   series, historical dashboards and Alertmanager thresholds. Monetary
   * bigint gauges/counters are emitted as decimal strings (exact). Every
   * series is labelled with `instance` so multiple replicas are distinguishable.
   */
  toPrometheus(): string {
    const instance =
      process.env.PROMETHEUS_INSTANCE || process.env.POD_NAME || process.env.HOSTNAME || 'api';
    const lines: string[] = [];
    const label = `instance="${instance}"`;
    const esc = (s: string) => s.replace(/"/g, '\\"');
    // Convert an internal key like `ad_served{currency=USD}` into a
    // Prometheus-valid `ad_served{currency="USD",instance="..."}`.
    const promName = (key: string): { name: string; labels: string } => {
      const m = key.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\{(.+)\}$/);
      if (!m) return { name: key, labels: label };
      const inner = m[2]
        .split(',')
        .map((pair) => {
          const eq = pair.indexOf('=');
          const k = pair.slice(0, eq).trim();
          const v = pair.slice(eq + 1).trim();
          return `${k}="${esc(v)}"`;
        })
        .join(',');
      return { name: m[1], labels: `${inner},${label}` };
    };
    for (const [key, value] of this.counters) {
      const { name, labels } = promName(key);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}{${labels}} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      const { name, labels } = promName(key);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}{${labels}} ${value}`);
    }
    for (const [key, value] of this.moneyCounters) {
      const { name, labels } = promName(key);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}{${labels}} ${value.toString()}`);
    }
    for (const [key, value] of this.moneyGauges) {
      const { name, labels } = promName(key);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}{${labels}} ${value.toString()}`);
    }
    return lines.join('\n') + '\n';
  }

  // --- Ad serving (P1.24) ---
  recordAdRequest(): void {
    this.increment('ad_requests');
  }
  recordAdEligible(): void {
    this.increment('ad_eligible');
  }
  recordAdIneligible(reason: string): void {
    this.increment(`ad_ineligible{reason=${reason}}`);
  }
  recordReservationFailure(): void {
    this.increment('reservation_failures');
  }
  recordAuctionRetry(): void {
    this.increment('auction_retries');
  }
  recordAdServedByCurrency(currency: string): void {
    this.increment(`ad_served{currency=${currency}}`);
  }
  recordQualifiedImpression(): void {
    this.increment('qualified_impressions');
  }
  recordClick(): void {
    this.increment('clicks');
  }
  recordDuplicateAdRequest(): void {
    this.increment('duplicate_ad_requests');
  }
  recordUnsafeCreativeRejection(): void {
    this.increment('unsafe_creative_rejections');
  }

  // --- Wait detection (P1.24) ---
  recordWaitDetected(signal: string): void {
    this.increment(`wait_detected{signal=${signal}}`);
  }
  recordLowConfidenceRejection(): void {
    this.increment('low_confidence_rejections');
  }
  recordFalsePositive(): void {
    this.increment('false_positives');
  }
  recordWaitWithoutEnd(): void {
    this.increment('waits_without_end');
  }
  recordDetectorVersionAdoption(version: string): void {
    this.increment(`detector_version{version=${version}}`);
  }

  // --- Money (P1.24) ---
  recordCampaignSpendMinor(currency: string, minor: bigint): void {
    this.incrementMoney(`campaign_spend_minor{currency=${currency}}`, minor);
  }
  recordReservation(): void {
    this.increment('reservations');
  }
  recordReservationDrift(): void {
    this.increment('reservation_drift');
  }
  recordDeveloperEarnings(): void {
    this.increment('developer_earnings_events');
  }
  recordPlatformLedgerDiscrepancyMinor(minor: bigint): void {
    this.gaugeMoney('platform_ledger_discrepancy_minor', minor);
  }
  recordPayoutAllocations(): void {
    this.increment('payout_allocations');
  }
  recordPayoutState(status: string): void {
    this.increment(`payout_state{status=${status}}`);
  }
  recordRetainedPayoutFence(): void {
    this.increment('retained_payout_fences');
  }

  // --- Reliability (P1.24) ---
  recordError(): void {
    this.increment('errors');
  }
  recordTransactionRetry(): void {
    this.increment('transaction_retries');
  }
  recordRedisFailure(): void {
    this.increment('redis_failures');
  }
  recordProviderBreakerOpen(provider: string): void {
    this.increment(`provider_breaker_open{provider=${provider}}`);
  }
  recordOutboxBacklog(size: number): void {
    this.gauge('outbox_backlog', size);
  }
  recordFailedAuditRows(count: number): void {
    this.gauge('failed_audit_rows', count);
  }
  recordLedgerDiscrepancy(): void {
    this.increment('ledger_discrepancies');
  }
}
