import { describe, expect, it } from 'vitest';

import { authoritativePayoutAmountMinor, minorToMajorInputValue } from './amounts';

describe('admin payout amount helpers', () => {
  it('uses approved minor units when a payout was partially approved', () => {
    expect(authoritativePayoutAmountMinor({
      requestedAmountMinor: 5000,
      approvedAmountMinor: 3000,
    })).toBe(3000);
  });

  it('falls back to requested minor units when no approval override exists', () => {
    expect(authoritativePayoutAmountMinor({
      requestedAmountMinor: 5000,
      approvedAmountMinor: null,
    })).toBe(5000);
  });

  it('formats minor-unit amounts as major-unit input values', () => {
    expect(minorToMajorInputValue(3000)).toBe('30');
    expect(minorToMajorInputValue(3050)).toBe('30.50');
    expect(minorToMajorInputValue(3055)).toBe('30.55');
  });
});
