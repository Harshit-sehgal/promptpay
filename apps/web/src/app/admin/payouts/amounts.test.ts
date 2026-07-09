import { describe, expect, it } from 'vitest';

import { authoritativePayoutAmountMinor, minorToMajorInputValue } from './amounts';

describe('admin payout amount helpers', () => {
  it('uses approved minor units when a payout was partially approved', () => {
    expect(
      authoritativePayoutAmountMinor({
        requestedAmountMinor: 5000,
        approvedAmountMinor: 3000,
      }),
    ).toBe(3000);
  });

  it('falls back to requested minor units when no approval override exists', () => {
    expect(
      authoritativePayoutAmountMinor({
        requestedAmountMinor: 5000,
        approvedAmountMinor: null,
      }),
    ).toBe(5000);
  });

  it('formats minor-unit amounts as currency-aware major-unit input values', () => {
    // USD (exponent 2)
    expect(minorToMajorInputValue(3000, 'USD')).toBe('30');
    expect(minorToMajorInputValue(3050, 'USD')).toBe('30.5');
    expect(minorToMajorInputValue(3055, 'USD')).toBe('30.55');
    // JPY (exponent 0) — must NOT be divided by 100 (A-031 regression)
    expect(minorToMajorInputValue(1000, 'JPY')).toBe('1000');
  });
});
