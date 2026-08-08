import { describe, expect, it } from 'vitest';

import { parsePaginationParam } from './pagination-query';

describe('parsePaginationParam', () => {
  it('passes through ordinary values', () => {
    expect(parsePaginationParam('1')).toBe(1);
    expect(parsePaginationParam('25')).toBe(25);
    expect(parsePaginationParam('100')).toBe(100);
  });

  it('returns undefined for absent or empty input, so the endpoint default applies', () => {
    expect(parsePaginationParam(undefined)).toBeUndefined();
    expect(parsePaginationParam('')).toBeUndefined();
    expect(parsePaginationParam('   ')).toBeUndefined();
  });

  it('rejects non-numeric input instead of producing NaN', () => {
    // This is the whole point. `Number('abc')` is NaN, and the downstream clamp
    // `Math.min(100, Math.max(1, NaN))` is also NaN — so without this, `take`
    // and `skip` reached the query layer as NaN.
    for (const bad of ['abc', 'null', 'undefined', '{}', '1abc', 'NaN']) {
      expect(parsePaginationParam(bad), `${bad} must not parse`).toBeUndefined();
    }
  });

  it('rejects infinities', () => {
    // `Number('1e999')` is Infinity, which survives Math.min/Math.max exactly
    // the way NaN does.
    expect(parsePaginationParam('1e999')).toBeUndefined();
    expect(parsePaginationParam('Infinity')).toBeUndefined();
    expect(parsePaginationParam('-Infinity')).toBeUndefined();
  });

  it('rejects zero and negatives rather than clamping them silently', () => {
    expect(parsePaginationParam('0')).toBeUndefined();
    expect(parsePaginationParam('-1')).toBeUndefined();
    expect(parsePaginationParam('-9999')).toBeUndefined();
  });

  it('truncates fractions', () => {
    expect(parsePaginationParam('2.9')).toBe(2);
  });

  it('caps at the Postgres integer ceiling', () => {
    expect(parsePaginationParam('999999999999')).toBe(2_147_483_647);
  });

  it('never returns a value that survives a clamp as NaN', () => {
    // Property check against the exact clamp the services use.
    const clamp = (v: number | undefined) => Math.min(100, Math.max(1, v ?? 20));
    for (const raw of ['abc', '', '0', '-5', '1e999', 'NaN', '50', '999999999999']) {
      const clamped = clamp(parsePaginationParam(raw));
      expect(Number.isInteger(clamped), `clamp(${raw}) = ${clamped}`).toBe(true);
      expect(clamped).toBeGreaterThanOrEqual(1);
      expect(clamped).toBeLessThanOrEqual(100);
    }
  });
});
