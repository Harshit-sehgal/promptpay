import { MetricsService } from './metrics.service';

describe('MetricsService — Prometheus + bigint safety (P1.24)', () => {
  it('stores and exposes bigint monetary counters without precision loss', () => {
    const m = new MetricsService();
    // Above Number.MAX_SAFE_INTEGER (2^53): 9_000_000_000_000_000n
    const huge = 9_000_000_000_000_000n;
    m.recordCampaignSpendMinor('USD', huge);
    m.recordCampaignSpendMinor('USD', 1n);
    expect(m.getMoneyCounter('campaign_spend_minor{currency=USD}')).toBe(9_000_000_000_000_001n);
    // JSON snapshot stringifies exactly — no Number() coercion occurred.
    const snap = m.snapshot();
    expect(snap.moneyCounters?.['campaign_spend_minor{currency=USD}']).toBe('9000000000000001');
    expect(snap.moneyGauges).toEqual({});
  });

  it('stores bigint monetary gauges exactly', () => {
    const m = new MetricsService();
    m.recordPlatformLedgerDiscrepancyMinor(123_456_789_012_345n);
    expect(m.getMoneyGauge('platform_ledger_discrepancy_minor')).toBe(123_456_789_012_345n);
    const snap = m.snapshot();
    expect(snap.moneyGauges?.['platform_ledger_discrepancy_minor']).toBe('123456789012345');
  });

  it('renders Prometheus exposition with quoted labels + instance label', () => {
    const m = new MetricsService();
    m.increment('ad_requests');
    m.increment('ad_served{currency=USD}');
    m.recordCampaignSpendMinor('EUR', 5000n);
    const out = m.toPrometheus();
    expect(out).toContain('# TYPE ad_requests counter');
    expect(out).toContain('ad_requests{instance="api"} 1');
    // label value must be quoted in Prometheus format
    expect(out).toContain('ad_served{currency="USD",instance="api"} 1');
    // bigint monetary counter rendered as decimal string, with quoted label
    expect(out).toContain('campaign_spend_minor{currency="EUR",instance="api"} 5000');
  });

  it('honours a custom instance label from env', () => {
    const prev = process.env.PROMETHEUS_INSTANCE;
    process.env.PROMETHEUS_INSTANCE = 'api-prod-7';
    try {
      const m = new MetricsService();
      m.increment('errors');
      const out = m.toPrometheus();
      expect(out).toContain('errors{instance="api-prod-7"} 1');
    } finally {
      if (prev === undefined) delete process.env.PROMETHEUS_INSTANCE;
      else process.env.PROMETHEUS_INSTANCE = prev;
    }
  });

  it('rejects non-bigint monetary inputs (defensive)', () => {
    const m = new MetricsService();
    // @ts-expect-error deliberately wrong type
    m.incrementMoney('bad', 5 as unknown);
    expect(m.getMoneyCounter('bad')).toBe(0n);
  });
});
