import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { buildReportsDateFilter } from './advertiser.constants';

/**
 * Query-parameter type confusion in the reports date range.
 *
 * `@Query('to') to?: string` is a compile-time claim only. Express turns a
 * repeated or bracketed parameter into an array, so the runtime value can be
 * `string[]` while every type in the call chain says `string`.
 */
describe('buildReportsDateFilter — parameter tampering', () => {
  it('rejects an array-valued `to` instead of trusting the declared type', () => {
    expect(() =>
      buildReportsDateFilter(undefined, ['2026-01-01T12:00:00Z'] as unknown as string),
    ).toThrow(BadRequestException);
  });

  it('rejects an array-valued `from`', () => {
    expect(() =>
      buildReportsDateFilter(['2026-01-01', '2026-02-01'] as unknown as string, undefined),
    ).toThrow(BadRequestException);
  });

  it('rejects non-string scalars', () => {
    expect(() => buildReportsDateFilter(undefined, 20260101 as unknown as string)).toThrow(
      BadRequestException,
    );
  });

  /**
   * The regression this guards. `['2026-01-01T12:00:00Z'].includes('T')` is
   * false, so the date-only branch appended a second suffix and produced
   * `2026-01-01T12:00:00ZT00:00:00.000Z` — an Invalid Date. `spanDays` then
   * evaluated to NaN, and `NaN > maxRangeDays` is false, so a range far wider
   * than the limit passed the A-032 check instead of being refused.
   */
  it('never lets an unparseable upper bound disable the maximum-range guard', () => {
    expect(() =>
      buildReportsDateFilter('2020-01-01', ['2026-01-01T12:00:00Z'] as unknown as string, 31),
    ).toThrow(BadRequestException);
  });

  it('still enforces the maximum range for well-formed input', () => {
    expect(() => buildReportsDateFilter('2020-01-01', '2026-01-01', 31)).toThrow(
      /exceeds the maximum allowed span/,
    );
  });

  it('accepts ordinary date-only and ISO values', () => {
    const dateOnly = buildReportsDateFilter('2026-01-01', '2026-01-31');
    expect(dateOnly.gte).toEqual(new Date('2026-01-01'));
    // Date-only `to` is inclusive of the whole end day via an exclusive next-day bound.
    expect(dateOnly.lt).toEqual(new Date('2026-02-01T00:00:00.000Z'));

    const iso = buildReportsDateFilter('2026-01-01', '2026-01-31T23:59:59.000Z');
    expect(iso.lte).toEqual(new Date('2026-01-31T23:59:59.000Z'));
  });

  it('treats an omitted range as unbounded', () => {
    expect(buildReportsDateFilter(undefined, undefined)).toEqual({});
  });
});
