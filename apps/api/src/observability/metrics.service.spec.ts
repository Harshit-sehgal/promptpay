import { describe, expect, it } from 'vitest';

import { MetricsService } from './metrics.service';

describe('MetricsService (P1.24)', () => {
  it('increments and reads counters', () => {
    const m = new MetricsService();
    m.increment('ad_requests');
    m.increment('ad_requests', 4);
    expect(m.getCounter('ad_requests')).toBe(5);
  });

  it('ignores non-finite increments', () => {
    const m = new MetricsService();
    m.increment('x', Number.NaN);
    m.increment('x', Infinity);
    expect(m.getCounter('x')).toBe(0);
  });

  it('sets gauges and snapshots a stable shape', () => {
    const m = new MetricsService();
    m.gauge('outbox_backlog', 3);
    m.recordAdServedByCurrency('USD');
    m.recordWaitDetected('ai_generation');
    const snap = m.snapshot();
    expect(snap.gauges['outbox_backlog']).toBe(3);
    expect(snap.counters['ad_served{currency=USD}']).toBe(1);
    expect(snap.counters['wait_detected{signal=ai_generation}']).toBe(1);
    expect(typeof snap.timestamp).toBe('string');
  });

  it('semantic helpers map to stable counter names', () => {
    const m = new MetricsService();
    m.recordLedgerDiscrepancy();
    m.recordPayoutState('processing');
    m.recordQualifiedImpression();
    m.recordClick();
    m.recordReservationDrift();
    expect(m.getCounter('ledger_discrepancies')).toBe(1);
    expect(m.getCounter('payout_state{status=processing}')).toBe(1);
    expect(m.getCounter('qualified_impressions')).toBe(1);
    expect(m.getCounter('clicks')).toBe(1);
    expect(m.getCounter('reservation_drift')).toBe(1);
  });
});
