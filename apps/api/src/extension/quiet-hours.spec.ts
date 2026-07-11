import { describe, expect, it } from 'vitest';

import { formatHHMMInZone, isTimeInRange } from './quiet-hours';

const INSTANT = new Date('2026-01-15T12:00:00.000Z');

describe('isTimeInRange (A-058 / #3)', () => {
  it('includes the window for a same-day range', () => {
    expect(isTimeInRange('12:00', '08:00', '22:00')).toBe(true);
    expect(isTimeInRange('23:00', '08:00', '22:00')).toBe(false);
  });

  it('wraps past midnight when start > end', () => {
    expect(isTimeInRange('23:00', '22:00', '08:00')).toBe(true);
    expect(isTimeInRange('07:00', '22:00', '08:00')).toBe(true);
    expect(isTimeInRange('12:00', '22:00', '08:00')).toBe(false);
  });

  it('treats both endpoints as inclusive', () => {
    expect(isTimeInRange('08:00', '08:00', '22:00')).toBe(true);
    expect(isTimeInRange('22:00', '08:00', '22:00')).toBe(true);
  });
});

describe('formatHHMMInZone (A-058 / #3)', () => {
  it('formats UTC deterministically', () => {
    expect(formatHHMMInZone(INSTANT, 'UTC')).toBe('12:00');
  });

  it('applies the timezone offset', () => {
    expect(formatHHMMInZone(INSTANT, 'America/New_York')).toBe('07:00'); // EST (UTC-5)
    expect(formatHHMMInZone(INSTANT, 'Asia/Kolkata')).toBe('17:30'); // UTC+5:30
  });

  it('coerces midnight to 00:00', () => {
    expect(formatHHMMInZone(new Date('2026-01-15T00:00:00.000Z'), 'UTC')).toBe('00:00');
  });

  it('falls back to UTC for an unknown timezone', () => {
    expect(formatHHMMInZone(INSTANT, 'Not/AZone')).toBe('12:00');
  });
});
