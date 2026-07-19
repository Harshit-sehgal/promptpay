import { Injectable, Logger } from '@nestjs/common';

/**
 * Operational metrics sink.
 *
 * Lightweight, in-process counters/gauges covering the ad-serving, wait-
 * detection, money and reliability surfaces required by P1.24. It is
 * intentionally dependency-free (no external TSDB) so it cannot fail the
 * request path: every emit is a Map mutation. A real deployment can scrape
 * `GET /observability/metrics` or later forward `snapshot()` to Prometheus.
 *
 * Counts are exact for event rates; bigint monetary gauges are coerced to
 * `number` for display only — the authoritative exact reconciliation lives in
 * the money-integrity report, not here.
 */
export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timestamp: string;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

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
      timestamp: new Date().toISOString(),
    };
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
    this.increment(`campaign_spend_minor{currency=${currency}}`, Number(minor));
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
    this.gauge('platform_ledger_discrepancy_minor', Number(minor));
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
