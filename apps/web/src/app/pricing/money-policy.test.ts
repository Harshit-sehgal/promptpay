import { describe, expect, it } from 'vitest';

import {
  CURRENCY_POLICY,
  depositMinimumMinor,
  formatMinorUnits,
  LAUNCH_INCENTIVE_SPLIT,
  payoutMinimumMinor,
  REVENUE_SPLIT,
} from '@waitlayer/shared';

// A-080: The public money-policy pages (pricing.tsx, payout-policy.tsx) render
// their thresholds and currency lists directly from the shared policy above.
// These assertions pin that contract so a future edit that hardcodes a
// different threshold (e.g. the old $50 minimum-deposit / $50 payout claims)
// or drops multi-currency support fails CI instead of silently drifting from
// the runtime API enforcement in @waitlayer/shared.
describe('public money-policy matches runtime shared policy (A-080)', () => {
  it('exposes a minimum payout of $10.00 (1000 minor) for USD', () => {
    expect(payoutMinimumMinor('USD')).toBe(1000);
    expect(formatMinorUnits(payoutMinimumMinor('USD'), 'USD')).toBe('$10.00');
  });

  it('exposes a minimum deposit of $1.00 (100 minor) for USD', () => {
    expect(depositMinimumMinor('USD')).toBe(100);
    expect(formatMinorUnits(depositMinimumMinor('USD'), 'USD')).toBe('$1.00');
  });

  it('supports multiple payout currencies (not USD-only)', () => {
    const codes = Object.keys(CURRENCY_POLICY);
    expect(codes).toContain('USD');
    expect(codes.length).toBeGreaterThan(1);
    for (const code of codes) {
      expect(payoutMinimumMinor(code)).toBeGreaterThan(0);
    }
  });

  it('standard revenue split is 60/30/10 and launch incentive is 80/10/10 but not auto-applied', () => {
    expect(REVENUE_SPLIT).toEqual({ USER: 0.6, PLATFORM: 0.3, RESERVE: 0.1 });
    expect(LAUNCH_INCENTIVE_SPLIT).toEqual({ USER: 0.8, PLATFORM: 0.1, RESERVE: 0.1 });
  });
});
