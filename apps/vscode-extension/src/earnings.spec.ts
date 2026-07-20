import { describe, expect, it } from 'vitest';

import {
  convertIfQuoted,
  formatBreakdown,
  parseByCurrency,
  resolveDisplayCurrency,
} from './earnings';

describe('earnings — parseByCurrency (P1.4)', () => {
  it('returns an empty map for undefined', () => {
    expect(parseByCurrency(undefined)).toEqual({});
  });

  it('parses stringified bigints exactly (no precision loss)', () => {
    expect(parseByCurrency({ USD: '12345', JPY: '1500' })).toEqual({
      USD: 12345n,
      JPY: 1500n,
    });
  });
});

describe('earnings — resolveDisplayCurrency (P1.4)', () => {
  it('falls back to the scalar currency when there is no positive per-currency data', () => {
    expect(resolveDisplayCurrency(undefined, undefined, 'EUR')).toEqual({
      currency: 'EUR',
      fromPreferred: false,
    });
    expect(resolveDisplayCurrency({ USD: '0' }, undefined, 'EUR')).toEqual({
      currency: 'EUR',
      fromPreferred: false,
    });
  });

  it('selects the first positive currency in ascending ISO order, never by magnitude', () => {
    // JPY has a SMALLER raw value than USD but must win by ISO-4217 order.
    const res = resolveDisplayCurrency({ JPY: '1000', USD: '9999' }, undefined, 'USD');
    expect(res.currency).toBe('JPY');
    expect(res.fromPreferred).toBe(false);
  });

  it('honors a preferred currency that is present in the balance', () => {
    const res = resolveDisplayCurrency({ USD: '100', EUR: '50' }, 'EUR', 'USD');
    expect(res.currency).toBe('EUR');
    expect(res.fromPreferred).toBe(true);
  });

  it('does NOT fabricate a conversion when the preferred currency is absent', () => {
    const res = resolveDisplayCurrency({ USD: '100' }, 'GBP', 'USD');
    expect(res.currency).toBe('USD');
    expect(res.fromPreferred).toBe(false);
    expect(res.note).toContain('GBP');
    expect(res.note).toContain('conversion quote unavailable');
  });
});

describe('earnings — formatBreakdown (P1.4)', () => {
  it('renders per-currency lines sorted by ISO code', () => {
    expect(formatBreakdown({ USD: '12345', JPY: '1500' })).toEqual(['JPY: ¥1,500', 'USD: $123.45']);
  });

  it('returns [] for undefined', () => {
    expect(formatBreakdown(undefined)).toEqual([]);
  });
});

describe('earnings — convertIfQuoted guard (P1.4)', () => {
  const quote = {
    from: 'USD',
    to: 'JPY',
    rateMinor: 150n,
    denominator: 1n,
    source: 'test',
    timestamp: 0,
  };

  it('returns the amount unchanged when no quote is supplied (never fabricates)', () => {
    expect(convertIfQuoted(100n, 'USD')).toEqual({ amountMinor: 100n, currency: 'USD' });
  });

  it('converts only with a real quote and never mutates the input', () => {
    const out = convertIfQuoted(100n, 'USD', quote);
    expect(out).toEqual({ amountMinor: 15000n, currency: 'JPY' });
  });

  it('ignores a quote whose source currency does not match', () => {
    expect(convertIfQuoted(100n, 'EUR', quote)).toEqual({
      amountMinor: 100n,
      currency: 'EUR',
    });
  });
});
