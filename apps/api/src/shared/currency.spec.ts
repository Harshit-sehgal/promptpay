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
  primaryCurrency,
} from '@waitlayer/shared';
import { PayoutProvider } from '@waitlayer/shared';

describe('currency policy table', () => {
  it('treats USD as 2-decimal with a 1000 minor payout floor', () => {
    const policy = getCurrencyPolicy('USD');
    expect(policy).not.toBeNull();
    expect(policy!.minorUnitExponent).toBe(2);
    expect(payoutMinimumMinor('USD')).toBe(1000n);
    expect(depositMinimumMinor('USD')).toBe(100n);
  });

  it('handles a non-2-decimal currency (JPY zero-decimal)', () => {
    expect(isSupportedCurrency('JPY')).toBe(true);
    expect(minorUnitExponent('JPY')).toBe(0);
    // 1000 JPY minor units formats as ¥1,000 (no fractional digits).
    expect(formatMinorUnits(1000n, 'JPY')).toBe('¥1,000');
    // USD still renders cents.
    expect(formatMinorUnits(1000n, 'USD')).toBe('$10.00');
  });

  it('falls back to USD defaults for unknown currencies', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(getCurrencyPolicy('nope')).toBeNull();
    expect(payoutMinimumMinor('XYZ')).toBe(1000n);
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

  describe('primaryCurrency (multi-currency summary fix)', () => {
    it('picks the currency with the strictly-largest positive balance', () => {
      expect(primaryCurrency({ USD: 50n, EUR: 30n })).toBe('USD');
      expect(primaryCurrency({ EUR: 30n, USD: 50n })).toBe('USD');
    });

    it('returns a non-USD currency when it is the only positive one', () => {
      expect(primaryCurrency({ EUR: 30n })).toBe('EUR');
      expect(primaryCurrency({ USD: 0n, EUR: 12n })).toBe('EUR');
    });

    it('falls back to USD when the map is empty or all entries are non-positive', () => {
      expect(primaryCurrency({})).toBe('USD');
      expect(primaryCurrency({ USD: 0n, EUR: 0n })).toBe('USD');
      expect(primaryCurrency({ USD: -5n })).toBe('USD');
    });
  });
});
