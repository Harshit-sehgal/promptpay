import { describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nestjs';

import { AlertsService } from './alerts.service';
import { MetricsService } from './metrics.service';

vi.mock('@sentry/nestjs', () => ({
  captureMessage: vi.fn(),
}));

describe('AlertsService (P1.25)', () => {
  it('increments an alert metric and logs, but does not call Sentry without a DSN', () => {
    delete process.env.SENTRY_DSN;
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    alerts.alert('ledger_discrepancy', { currency: 'USD', totalDiffMinor: '500' });
    expect(metrics.getCounter('alert{event=ledger_discrepancy}')).toBe(1);
    expect(vi.mocked(Sentry.captureMessage)).not.toHaveBeenCalled();
  });

  it('forwards to Sentry when a DSN is configured', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    alerts.alert('audit_dead_letter', { count: 2 });
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalled();
    delete process.env.SENTRY_DSN;
  });

  it('redacts sensitive context keys before sending', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    alerts.alert('payout_paid_without_provider_tx', {
      payoutId: 'req_1',
      destination: 'dev@x.com',
      amountMinor: '2500',
    });
    const call = vi.mocked(Sentry.captureMessage).mock.calls.at(-1)!;
    const extra = (call[1] as { extra: Record<string, unknown> | undefined }).extra ?? {};
    expect(extra.payoutId).toBe('req_1');
    expect(extra.destination).toBe('<redacted>');
    expect(extra.amountMinor).toBe('<redacted>');
    delete process.env.SENTRY_DSN;
  });

  it('semantic helpers dispatch the right event', () => {
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    alerts.alertPayoutFenceAge({ payoutId: 'req_1', ageMs: 9_000_000 });
    expect(metrics.getCounter('alert{event=payout_fence_age}')).toBe(1);
  });

  it('suppresses duplicate alerts within the cooldown window', () => {
    delete process.env.SENTRY_DSN;
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    const first = alerts.sendAlert('ledger_discrepancy', 'k1', { totalDiffMinor: '500' });
    const second = alerts.sendAlert('ledger_discrepancy', 'k1', { totalDiffMinor: '500' });
    expect(first).toBe(true);
    expect(second).toBe(false);
    // Metric (and Sentry/side effects) only fire once.
    expect(metrics.getCounter('alert{event=ledger_discrepancy}')).toBe(1);
  });

  it('still fires a distinct alert (different key) within the cooldown', () => {
    delete process.env.SENTRY_DSN;
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    const first = alerts.sendAlert('ledger_discrepancy', 'k1', {});
    const distinct = alerts.sendAlert('ledger_discrepancy', 'k2', {});
    expect(first).toBe(true);
    expect(distinct).toBe(true);
    expect(metrics.getCounter('alert{event=ledger_discrepancy}')).toBe(2);
  });

  it('wires a declared alert (payout_escalation) through sendAlert', () => {
    delete process.env.SENTRY_DSN;
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    const spy = vi.spyOn(alerts, 'sendAlert');
    alerts.alertPayoutEscalation({ payoutId: 'req_x', ageMs: 99, reason: 'still_processing' });
    expect(spy).toHaveBeenCalledWith(
      'payout_escalation',
      'payout:req_x',
      expect.objectContaining({ payoutId: 'req_x', reason: 'still_processing' }),
    );
    // The wired path still forwards the underlying alert once.
    expect(metrics.getCounter('alert{event=payout_escalation}')).toBe(1);
  });
});
