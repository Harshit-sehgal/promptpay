import { describe, expect, it } from 'vitest';

import {
  campaignMaximumBudgetMinor,
  CURRENCY_POLICY,
  formatMinorUnits,
  majorToMinor,
  minorToMajorInputValue,
  minorUnitExponent,
  primaryCurrency,
} from './currency';

describe('currency policy — INR campaign budget (P1.13)', () => {
  it('INR max budget is ₹80,00,00,000 = 80,000,000,000 paise (80 crore)', () => {
    expect(campaignMaximumBudgetMinor('INR')).toBe(80_000_000_000n);
  });

  it('round-trips to major units: 80,000,000,000 paise = 800,000,000 rupees = ₹80,00,00,000', () => {
    const minor = campaignMaximumBudgetMinor('INR');
    expect(minor / 100n).toBe(800_000_000n);
  });
});

describe('currency policy — major/minor round-trip (P1.13)', () => {
  const codes = Object.keys(CURRENCY_POLICY);

  it.each(codes)(
    '%s: minorToMajorInputValue(majorToMinor(x)) round-trips for integer and decimal majors',
    (code) => {
      const exponent = minorUnitExponent(code);
      // Integer major value round-trips unchanged (no fraction to trim).
      const intMajor = '5000';
      expect(minorToMajorInputValue(majorToMinor(intMajor, code), code)).toBe(intMajor);
      if (exponent > 0) {
        // Decimal major whose fraction is exactly `exponent` digits and does
        // not end in zero, so the trailing-zero trim preserves it (e.g. "12.99").
        const decMajor = `12.${'9'.repeat(exponent)}`;
        expect(minorToMajorInputValue(majorToMinor(decMajor, code), code)).toBe(decMajor);
      } else {
        // Zero-decimal currency: a bare integer major must round-trip.
        expect(minorToMajorInputValue(majorToMinor('1234', code), code)).toBe('1234');
      }
    },
  );
});

describe('currency policy — formatMinorUnits respects per-currency semantics (P1.13)', () => {
  it('renders zero-decimal JPY with no fraction and a ¥ symbol', () => {
    expect(formatMinorUnits(1500n, 'JPY')).toBe('¥1,500');
  });

  it('renders 2-decimal USD with a $ symbol', () => {
    expect(formatMinorUnits(12345n, 'USD')).toBe('$123.45');
  });

  it('renders 2-decimal INR with an ₹ symbol', () => {
    expect(formatMinorUnits(400000n, 'INR')).toBe('₹4,000.00');
  });

  it("matches primaryCurrency selection: formatting uses the chosen currency's policy, not USD's", () => {
    // primaryCurrency returns the first positive-balance currency in ascending
    // ISO-4217 order. Here JPY < USD, so JPY is primary even though USD has a
    // larger raw minor total (raw minor units are NOT comparable across
    // currencies). formatMinorUnits must then render under JPY's zero-decimal
    // policy, never USD's 2-decimal policy.
    const totals: Record<string, bigint> = { JPY: 1000n, USD: 9999n };
    const primary = primaryCurrency(totals);
    expect(primary).toBe('JPY');
    expect(formatMinorUnits(totals[primary], primary)).toBe('¥1,000');
    // The USD total, formatted under its own policy, stays 2-decimal.
    expect(formatMinorUnits(totals.USD, 'USD')).toBe('$99.99');
  });
});
