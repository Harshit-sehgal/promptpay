import { describe, expect, it } from 'vitest';

import {
  campaignMaximumBudgetMinor,
  CURRENCY_POLICY,
  formatMinorUnits,
  highValueFenceReleaseMinor,
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

describe('highValueFenceReleaseMinor — precedence chain (P1.11)', () => {
  const GLOBAL_ENV = 'PAYOUT_FENCE_HIGH_VALUE_MINOR';
  const JPY_ENV = 'HIGH_VALUE_FENCE_JPY_MINOR';
  const USD_ENV = 'HIGH_VALUE_FENCE_USD_MINOR';

  const saved: Record<string, string | undefined> = {};
  const envKeys = [GLOBAL_ENV, JPY_ENV, USD_ENV];

  function saveEnv() {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  function restoreEnv() {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }

  it('uses the per-currency default map when no env override is set', () => {
    saveEnv();
    try {
      expect(highValueFenceReleaseMinor('USD')).toBe(1_000_000n);
      expect(highValueFenceReleaseMinor('JPY')).toBe(1_500_000n);
      expect(highValueFenceReleaseMinor('INR')).toBe(80_000_000n);
    } finally {
      restoreEnv();
    }
  });

  it('falls back to the safe default for unknown or missing currency codes', () => {
    saveEnv();
    try {
      expect(highValueFenceReleaseMinor('XXX')).toBe(1_000_000n);
      expect(highValueFenceReleaseMinor(null)).toBe(1_000_000n);
      expect(highValueFenceReleaseMinor(undefined)).toBe(1_000_000n);
    } finally {
      restoreEnv();
    }
  });

  it('per-currency env override beats the default map', () => {
    saveEnv();
    try {
      process.env[JPY_ENV] = '3000000';
      expect(highValueFenceReleaseMinor('JPY')).toBe(3_000_000n);
      // Other currencies still use their own defaults.
      expect(highValueFenceReleaseMinor('USD')).toBe(1_000_000n);
    } finally {
      restoreEnv();
    }
  });

  it('global env override beats both per-currency env and the default map', () => {
    saveEnv();
    try {
      process.env[GLOBAL_ENV] = '42';
      process.env[JPY_ENV] = '3000000';
      expect(highValueFenceReleaseMinor('JPY')).toBe(42n);
      expect(highValueFenceReleaseMinor('USD')).toBe(42n);
      expect(highValueFenceReleaseMinor('XXX')).toBe(42n);
    } finally {
      restoreEnv();
    }
  });

  it('ignores malformed env values and falls through to the next level', () => {
    saveEnv();
    try {
      // Negative / non-numeric / empty values are not valid minor-unit amounts.
      process.env[GLOBAL_ENV] = '-5';
      process.env[USD_ENV] = 'not-a-number';
      expect(highValueFenceReleaseMinor('USD')).toBe(1_000_000n);
      process.env[GLOBAL_ENV] = '';
      expect(highValueFenceReleaseMinor('JPY')).toBe(1_500_000n);
    } finally {
      restoreEnv();
    }
  });

  it('a configured policy value beats the default map but not env overrides', () => {
    saveEnv();
    const code = 'USD';
    const original = CURRENCY_POLICY[code].highValueFenceReleaseMinor;
    CURRENCY_POLICY[code].highValueFenceReleaseMinor = 7_777_777;
    try {
      expect(highValueFenceReleaseMinor(code)).toBe(7_777_777n);
      process.env[USD_ENV] = '123';
      expect(highValueFenceReleaseMinor(code)).toBe(123n);
    } finally {
      if (original === undefined) delete CURRENCY_POLICY[code].highValueFenceReleaseMinor;
      else CURRENCY_POLICY[code].highValueFenceReleaseMinor = original;
      restoreEnv();
    }
  });
});
