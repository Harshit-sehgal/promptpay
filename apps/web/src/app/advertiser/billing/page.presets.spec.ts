import { describe, expect, it } from 'vitest';

import { depositPresetMinorUnits } from './page';

describe('deposit presets', () => {
  it('never offers a JPY preset below the per-currency minimum', () => {
    const presets = depositPresetMinorUnits('JPY');
    expect(presets).toEqual([100n, 250n, 500n]);
    expect(presets.every((amount) => amount >= 100n)).toBe(true);
  });

  it('keeps the expected USD major-unit choices', () => {
    expect(depositPresetMinorUnits('USD')).toEqual([100n, 5000n, 10000n, 25000n, 50000n]);
  });
});
