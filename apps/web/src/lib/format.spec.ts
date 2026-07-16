import { describe, expect, it } from 'vitest';

import { bigintRatioPercent, formatCurrency } from './format';

describe('formatCurrency', () => {
  it('renders bigint minor units above Number.MAX_SAFE_INTEGER exactly', () => {
    expect(formatCurrency(9_007_199_254_740_993n, 'USD')).toBe('$90,071,992,547,409.93');
  });
});

describe('bigintRatioPercent', () => {
  it('preserves the ratio for monetary values above Number.MAX_SAFE_INTEGER', () => {
    const total = 18_014_398_509_481_986n;

    expect(bigintRatioPercent(9_007_199_254_740_993n, total, 1)).toBe(50);
  });

  it('rounds at the requested display precision', () => {
    expect(bigintRatioPercent(1n, 3n, 2)).toBe(33.33);
  });

  it('returns zero for empty or non-positive ratios', () => {
    expect(bigintRatioPercent(10n, 0n)).toBe(0);
    expect(bigintRatioPercent(0n, 10n)).toBe(0);
  });

  it('rejects unreasonable display precision', () => {
    expect(() => bigintRatioPercent(1n, 2n, 7)).toThrow(RangeError);
  });
});
