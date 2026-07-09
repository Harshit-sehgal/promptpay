import { describe, expect, it } from 'vitest';

import {
  CURRENCY_POLICY,
  depositMinimumMinor,
  formatMinorUnits,
  getCurrencyPolicy,
  isProviderSupportedForCurrency,
  isSupportedCurrency,
  minorUnitExponent,
  payoutMinimumMinor,
} from '@waitlayer/shared';
import { PayoutProvider } from '@waitlayer/shared';

describe('currency policy table', () => {
  it('treats USD as 2-decimal with a 1000 minor payout floor', () => {
    const policy = getCurrencyPolicy('USD');
    expect(policy).not.toBeNull();
    expect(policy!.minorUnitExponent).toBe(2);
    expect(payoutMinimumMinor('USD')).toBe(1000);
    expect(depositMinimumMinor('USD')).toBe(100);
  });

  it('handles a non-2-decimal currency (JPY zero-decimal)', () => {
    expect(isSupportedCurrency('JPY')).toBe(true);
    expect(minorUnitExponent('JPY')).toBe(0);
    // 1000 JPY minor units formats as ¥1,000 (no fractional digits).
    expect(formatMinorUnits(1000, 'JPY')).toBe('¥1,000');
    // USD still renders cents.
    expect(formatMinorUnits(1000, 'USD')).toBe('$10.00');
  });

  it('falls back to USD defaults for unknown currencies', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(getCurrencyPolicy('nope')).toBeNull();
    expect(payoutMinimumMinor('XYZ')).toBe(1000);
    expect(minorUnitExponent('XYZ')).toBe(2);
  });

  it('reports provider support per currency', () => {
    expect(isProviderSupportedForCurrency(PayoutProvider.WISE, 'EUR')).toBe(true);
    expect(isProviderSupportedForCurrency(PayoutProvider.STRIPE_CONNECT, 'INR')).toBe(false);
    expect(isProviderSupportedForCurrency(PayoutProvider.MANUAL, 'JPY')).toBe(true);
  });

  it('exposes a policy for every listed currency', () => {
    expect(Object.keys(CURRENCY_POLICY).length).toBeGreaterThanOrEqual(8);
  });
});
