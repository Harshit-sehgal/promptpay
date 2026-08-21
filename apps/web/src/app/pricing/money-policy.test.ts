import { describe, expect, it } from 'vitest';

import {
  CURRENCY_POLICY,
  depositMinimumMinor,
  formatMinorUnits,
  payoutMinimumMinor,
} from '@ateva/shared';

// Public pricing renders only configured thresholds/currency policy. Participant
// compensation is intentionally not expressed as a percentage of advertiser
// spend; the customer money-in and participant money-out flows are separate.
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
