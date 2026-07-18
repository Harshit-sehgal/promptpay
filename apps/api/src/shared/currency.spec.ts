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
    it('picks the first positive-balance currency in ascending code order', () => {
      // Old (buggy) behaviour picked the largest raw minor value. That is a
      // cross-currency magnitude comparison and is invalid. The fix picks the
      // first positive currency alphabetically — a deterministic, non-monetary
      // choice — so USD/EUR ordering no longer depends on raw minor magnitudes.
      expect(primaryCurrency({ USD: 50n, EUR: 30n })).toBe('EUR');
      expect(primaryCurrency({ EUR: 30n, USD: 50n })).toBe('EUR');
    });

    it('returns a non-USD currency when it is the only positive one', () => {
      expect(primaryCurrency({ EUR: 30n })).toBe('EUR');
      expect(primaryCurrency({ USD: 0n, EUR: 12n })).toBe('EUR');
    });

    it('falls back to USD when the map is empty or all entries are non-positive', () => {
      expect(primaryCurrency({})).toBe('USD');
      expect(primaryCurrency({ USD: 0n, EUR: 0n })).toBe('USD');
      expect(primaryCurrency({ USD: -5n })).toBe('USD');
      expect(primaryCurrency({ USD: -5n, EUR: -100n })).toBe('USD');
    });

    it('never compares raw minor units across currencies for JPY vs USD', () => {
      // 100 JPY minor units and 100 USD cents are NOT the same amount. The
      // old magnitude comparison would have called USD "larger" purely from
      // raw numerics that are incomparable across currencies. The deterministic
      // alphabetical pick returns EUR (the first positive) regardless of the
      // fact that JPY's raw 100 == USD's raw 100.
      expect(primaryCurrency({ JPY: 100n, USD: 100n, EUR: 1n })).toBe('EUR');
      expect(primaryCurrency({ JPY: 100n })).toBe('JPY');
      expect(primaryCurrency({ USD: 100n })).toBe('USD');
    });
  });
});
