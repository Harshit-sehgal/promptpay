import { describe, expect, it } from 'vitest';

import {
  addMoney,
  assertSameCurrency,
  compareMoney,
  type ConversionQuote,
  convertMoney,
  deserializeMoney,
  formatMoney,
  isPositiveMoney,
  isZeroMoney,
  type Money,
  serializeMoney,
  subtractMoney,
  validatePositiveMoney,
  zeroMoney,
} from './money';

const usd = (n: bigint): Money => ({ amountMinor: n, currency: 'USD' });
const jpy = (n: bigint): Money => ({ amountMinor: n, currency: 'JPY' });

describe('Money value object (P2.3)', () => {
  it('adds same-currency values without precision loss', () => {
    expect(addMoney(usd(1000n), usd(250n))).toEqual(usd(1250n));
  });

  it('subtracts same-currency values', () => {
    expect(subtractMoney(usd(1000n), usd(250n))).toEqual(usd(750n));
  });

  it('rejects addition across currencies', () => {
    expect(() => addMoney(usd(1000n), jpy(1000n))).toThrow(/cross-currency/);
  });

  it('rejects subtraction across currencies', () => {
    expect(() => subtractMoney(usd(1000n), jpy(1000n))).toThrow(/cross-currency/);
  });

  it('assertSameCurrency throws on mismatch', () => {
    expect(() => assertSameCurrency(usd(1n), jpy(1n))).toThrow(/cross-currency/);
  });

  it('compares same-currency values', () => {
    expect(compareMoney(usd(100n), usd(50n))).toBe(1);
    expect(compareMoney(usd(50n), usd(100n))).toBe(-1);
    expect(compareMoney(usd(100n), usd(100n))).toBe(0);
  });

  it('compares different currencies as an error, not a magnitude', () => {
    expect(() => compareMoney(usd(1n), jpy(1000n))).toThrow(/cross-currency/);
  });

  it('validates positive amounts and rejects zero/negative', () => {
    expect(isPositiveMoney(usd(1n))).toBe(true);
    expect(isPositiveMoney(usd(0n))).toBe(false);
    expect(isPositiveMoney(usd(-1n))).toBe(false);
    expect(() => validatePositiveMoney(usd(0n))).toThrow(/positive/);
    expect(() => validatePositiveMoney(usd(-5n))).toThrow(/positive/);
    expect(validatePositiveMoney(usd(5n))).toBeUndefined();
  });

  it('zeroMoney is same-currency and zero', () => {
    const z = zeroMoney('EUR');
    expect(z.currency).toBe('EUR');
    expect(isZeroMoney(z)).toBe(true);
  });

  it('rejects an unsupported currency on construction helpers', () => {
    expect(() => zeroMoney('XYZ')).toThrow(/unsupported currency/);
  });

  it('serializes amountMinor to a decimal string and round-trips', () => {
    const serialized = serializeMoney(usd(123456n));
    expect(serialized).toEqual({ amountMinor: '123456', currency: 'USD' });
    const back = deserializeMoney(serialized);
    expect(back).toEqual(usd(123456n));
  });

  it('formats respecting the currency exponent', () => {
    // JPY is zero-decimal: 1000 minor == ¥1,000, not ¥10.00.
    expect(formatMoney(jpy(1000n))).toBe('¥1,000');
    expect(formatMoney(usd(1000n))).toBe('$10.00');
  });

  it('converts only via an explicit quote and never mutates input', () => {
    const quote: ConversionQuote = {
      from: 'USD',
      to: 'JPY',
      rateMinor: 150n, // 150 JPY minor per 1 USD minor
      denominator: 1n,
      source: 'test-rate',
      timestamp: 0,
    };
    const input = usd(100n);
    const converted = convertMoney(input, quote);
    expect(converted).toEqual(jpy(15000n));
    // input unchanged (immutable conversion)
    expect(input).toEqual(usd(100n));
  });

  it('convertMoney rejects a mismatched source currency', () => {
    const quote: ConversionQuote = {
      from: 'USD',
      to: 'JPY',
      rateMinor: 150n,
      denominator: 1n,
      source: 'test-rate',
      timestamp: 0,
    };
    expect(() => convertMoney(jpy(100n), quote)).toThrow(/quote is for USD/);
  });

  it('convertMoney uses the integer ratio exactly', () => {
    const quote: ConversionQuote = {
      from: 'USD',
      to: 'EUR',
      rateMinor: 92n, // 0.92 EUR per 1 USD
      denominator: 100n,
      source: 'test-rate',
      timestamp: 0,
    };
    // 1000 USD minor * 92 / 100 = 920 EUR minor
    expect(convertMoney(usd(1000n), quote)).toEqual({ amountMinor: 920n, currency: 'EUR' });
  });
});
