import { describe, expect, it } from 'vitest';

import { bigintRatioPercent, formatCurrency, formatRelativeTime } from './format';

describe('formatCurrency', () => {
  it('renders bigint minor units above Number.MAX_SAFE_INTEGER exactly', () => {
    expect(formatCurrency(9_007_199_254_740_993n, 'USD')).toBe('$90,071,992,547,409.93');
  });
});

describe('bigintRatioPercent', () => {
  it('preserves the ratio for monetary values above Number.MAX_SAFE_INTEGER', () => {
    const total = 18_014_398_509_481_986n;

    expect(bigintRatioPercent(9_007_199_254_740_993n, total, 1)).toBe(50);
  });

  it('rounds at the requested display precision', () => {
    expect(bigintRatioPercent(1n, 3n, 2)).toBe(33.33);
  });

  it('returns zero for empty or non-positive ratios', () => {
    expect(bigintRatioPercent(10n, 0n)).toBe(0);
    expect(bigintRatioPercent(0n, 10n)).toBe(0);
  });

  it('rejects unreasonable display precision', () => {
    expect(() => bigintRatioPercent(1n, 2n, 7)).toThrow(RangeError);
  });
});

describe('formatRelativeTime direction and validity', () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it('renders future dates as "in X", not "just now"', () => {
    // The bug this exists for: every branch tested `> 0`, so a future
    // timestamp fell through to "just now". The developer earnings table
    // renders `availableAt` — set by the API to `Date.now() + holdDays` — under
    // a column headed "Available". Held money read as available immediately.
    //
    // The +1min offsets keep each case off a bucket boundary: `Date.now()`
    // advances between constructing the date and measuring it, so an exact
    // `+20 * HOUR` floors to 19h and the assertion would be flaky.
    expect(formatRelativeTime(new Date(Date.now() + 3 * DAY + 60_000))).toBe('in 3d');
    expect(formatRelativeTime(new Date(Date.now() + 20 * HOUR + 60_000))).toBe('in 20h');
    expect(formatRelativeTime(new Date(Date.now() + 45 * DAY + 60_000))).toBe('in 1mo');
    // 7 days is a week, and weeks are checked before days — same ordering the
    // past direction has always used.
    expect(formatRelativeTime(new Date(Date.now() + 7 * DAY + 60_000))).toBe('in 1w');
  });

  it('still renders past dates exactly as before', () => {
    expect(formatRelativeTime(new Date(Date.now() - 2 * HOUR))).toBe('2h ago');
    expect(formatRelativeTime(new Date(Date.now() - 3 * DAY))).toBe('3d ago');
    expect(formatRelativeTime(new Date(Date.now() - 400 * DAY))).toBe('1y ago');
  });

  it('keeps "just now" for the genuinely-now window in both directions', () => {
    expect(formatRelativeTime(new Date())).toBe('just now');
    expect(formatRelativeTime(new Date(Date.now() - 5_000))).toBe('just now');
    expect(formatRelativeTime(new Date(Date.now() + 5_000))).toBe('just now');
  });

  it('returns an em dash for an unparseable date rather than asserting "just now"', () => {
    // Absence of information must not render as a confident claim about now.
    expect(formatRelativeTime('not-a-date')).toBe('—');
    expect(formatRelativeTime(new Date('nonsense'))).toBe('—');
  });
});
