import { describe, expect, it } from 'vitest';

import {
  authoritativePayoutAmountMinor,
  majorInputToMinor,
  minorToMajorInputValue,
} from './amounts';

describe('admin payout amount helpers', () => {
  it('uses approved minor units when a payout was partially approved', () => {
    expect(
      authoritativePayoutAmountMinor({
        requestedAmountMinor: 5000n,
        approvedAmountMinor: 3000n,
      }),
    ).toBe(3000n);
  });

  it('falls back to requested minor units when no approval override exists', () => {
    expect(
      authoritativePayoutAmountMinor({
        requestedAmountMinor: 5000n,
        approvedAmountMinor: null,
      }),
    ).toBe(5000n);
  });

  it('formats minor-unit amounts as currency-aware major-unit input values', () => {
    // USD (exponent 2)
    expect(minorToMajorInputValue(3000n, 'USD')).toBe('30');
    expect(minorToMajorInputValue(3050n, 'USD')).toBe('30.5');
    expect(minorToMajorInputValue(3055n, 'USD')).toBe('30.55');
    // JPY (exponent 0) — must NOT be divided by 100 (A-031 regression)
    expect(minorToMajorInputValue(1000n, 'JPY')).toBe('1000');
  });

  it('round-trips amounts above Number.MAX_SAFE_INTEGER exactly', () => {
    const amountMinor = 9_007_199_254_740_993n;

    const inputValue = minorToMajorInputValue(amountMinor, 'USD');

    expect(inputValue).toBe('90071992547409.93');
    expect(majorInputToMinor(inputValue, 'USD')).toBe(amountMinor);
  });

  it('parses currency exponents exactly and rejects sub-minor-unit precision', () => {
    expect(majorInputToMinor('30.55', 'USD')).toBe(3055n);
    expect(majorInputToMinor('.5', 'USD')).toBe(50n);
    expect(majorInputToMinor('1000', 'JPY')).toBe(1000n);
    expect(majorInputToMinor('1000.0', 'JPY')).toBe(1000n);
    expect(majorInputToMinor('1000.1', 'JPY')).toBeNull();
    expect(majorInputToMinor('1.001', 'USD')).toBeNull();
    expect(majorInputToMinor('1e3', 'USD')).toBeNull();
  });
});
