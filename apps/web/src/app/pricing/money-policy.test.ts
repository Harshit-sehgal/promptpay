import { describe, expect, it } from 'vitest';

import {
  CURRENCY_POLICY,
  depositMinimumMinor,
  formatMinorUnits,
  payoutMinimumMinor,
} from '@ateva/shared';

// Public pricing renders only configured thresholds/currency policy.
//
// This comment used to claim participant compensation was "intentionally not
// expressed as a percentage of advertiser spend", and asserted nothing about
// it — while `LedgerMathTrait.calculateSplit` had always credited the developer
// 60% of the bid. A stated invariant that no test enforces is how the public
// copy and the ledger drifted apart in the first place. The 60/40 boundary is
// now asserted directly against the ledger in
// `apps/api/src/ledger/ledger.service.spec.ts` ("gives the participant 60% and
// Ateva 40%, which is what the site states").
//
// The money-in and money-out rails do remain separate: the advertiser's payment
// settles to Ateva in full, and the participant's 60% is an Ateva obligation
// paid through a different provider.
describe('public money-policy matches runtime shared policy', () => {
  it('exposes a minimum payout of $10.00 (1000 minor) for USD', () => {
    expect(payoutMinimumMinor('USD')).toBe(1000n);
    expect(formatMinorUnits(payoutMinimumMinor('USD'), 'USD')).toBe('$10.00');
  });

  it('exposes a minimum deposit of $1.00 (100 minor) for USD', () => {
    expect(depositMinimumMinor('USD')).toBe(100n);
    expect(formatMinorUnits(depositMinimumMinor('USD'), 'USD')).toBe('$1.00');
  });

  it('supports multiple configured currencies', () => {
    const codes = Object.keys(CURRENCY_POLICY);
    expect(codes).toContain('USD');
    expect(codes.length).toBeGreaterThan(1);
    for (const code of codes) {
      expect(payoutMinimumMinor(code)).toBeGreaterThan(0n);
    }
  });
});
