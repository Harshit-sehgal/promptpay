import { describe, expect, it } from 'vitest';

import { periodPreset } from './page';

describe('advertiser report presets', () => {
  it('returns exactly one inclusive calendar day for the 1-day preset', () => {
    expect(periodPreset(1, new Date(2026, 6, 13, 12))).toEqual({
      from: '2026-07-13',
      to: '2026-07-13',
    });
  });

  it('returns seven inclusive calendar days without an off-by-one', () => {
    expect(periodPreset(7, new Date(2026, 6, 13, 12))).toEqual({
      from: '2026-07-07',
      to: '2026-07-13',
    });
  });
});
