import { describe, expect, it } from 'vitest';

import { parseMajorToMinor, parseMinor } from './parse';

describe('parseMinor (bigint-safe)', () => {
  it('handles null/undefined as 0n', () => {
    expect(parseMinor(null)).toBe(0n);
    expect(parseMinor(undefined)).toBe(0n);
  });
  it('passes bigint through', () => {
    expect(parseMinor(123n)).toBe(123n);
  });
  it('accepts a safe integer number', () => {
    expect(parseMinor(42)).toBe(42n);
    expect(parseMinor(-7)).toBe(-7n);
  });
  it('rejects a non-integer number instead of rounding', () => {
    expect(() => parseMinor(12.5)).toThrow();
  });
  it('rejects a number above MAX_SAFE_INTEGER instead of rounding', () => {
    expect(() => parseMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  it('parses a decimal integer string exactly', () => {
    expect(parseMinor('1234')).toBe(1234n);
    expect(parseMinor('-99')).toBe(-99n);
    expect(parseMinor('  5  ')).toBe(5n);
  });
  it('rejects exponent notation, fractions, commas, NaN, Infinity', () => {
    expect(() => parseMinor('1e3')).toThrow();
    expect(() => parseMinor('12.5')).toThrow();
    expect(() => parseMinor('1,000')).toThrow();
    expect(() => parseMinor('NaN')).toThrow();
    expect(() => parseMinor('Infinity')).toThrow();
  });
});

describe('parseMajorToMinor (exact decimal parser)', () => {
  it('parses a 2-decimal USD value exactly', () => {
    expect(parseMajorToMinor('30.00', 2)).toBe(3000n);
    expect(parseMajorToMinor('30.5', 2)).toBe(3050n);
    expect(parseMajorToMinor('30.55', 2)).toBe(3055n);
  });
  it('parses a 0-decimal JPY value exactly (no fractional digits allowed)', () => {
    expect(parseMajorToMinor('1000', 0)).toBe(1000n);
    expect(() => parseMajorToMinor('1000.5', 0)).toThrow();
  });
  it('parses a 3-decimal BHD value exactly', () => {
    expect(parseMajorToMinor('1.234', 3)).toBe(1234n);
    expect(parseMajorToMinor('1.2', 3)).toBe(1200n);
  });
  it('rejects more decimal places than the exponent allows', () => {
    expect(() => parseMajorToMinor('10.001', 2)).toThrow();
    expect(() => parseMajorToMinor('1.2345', 3)).toThrow();
  });
  it('rejects exponent notation, commas, NaN, Infinity, malformed signs', () => {
    expect(() => parseMajorToMinor('1e2', 2)).toThrow();
    expect(() => parseMajorToMinor('1,000', 2)).toThrow();
    expect(() => parseMajorToMinor('NaN', 2)).toThrow();
    expect(() => parseMajorToMinor('Infinity', 2)).toThrow();
    expect(() => parseMajorToMinor('1.2.3', 2)).toThrow();
    expect(() => parseMajorToMinor('--5', 2)).toThrow();
  });
  it('rejects empty input', () => {
    expect(() => parseMajorToMinor('', 2)).toThrow();
    expect(() => parseMajorToMinor('   ', 2)).toThrow();
  });
  it('handles values above Number.MAX_SAFE_INTEGER without rounding', () => {
    // 90,071,992,547,409.93 → 9007199254740993 minor (exceeds 2^53).
    expect(parseMajorToMinor('90071992547409.93', 2)).toBe(9007199254740993n);
  });
  it('handles negative values exactly', () => {
    expect(parseMajorToMinor('-5.00', 2)).toBe(-500n);
  });
  it('accepts a number for convenience but rejects NaN/Infinity', () => {
    expect(parseMajorToMinor(30, 2)).toBe(3000n);
    expect(() => parseMajorToMinor(NaN, 2)).toThrow();
    expect(() => parseMajorToMinor(Infinity, 2)).toThrow();
  });
});
