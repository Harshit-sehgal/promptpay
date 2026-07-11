import { describe, expect, it } from 'vitest';

import { isUnderFrequencyCap } from './frequency-cap';

describe('isUnderFrequencyCap (A-061 / #3)', () => {
  it('is under cap when no caps are set', () => {
    expect(isUnderFrequencyCap({}, 10, 20)).toBe(true);
  });

  it('is under cap when counts are below the limits', () => {
    expect(isUnderFrequencyCap({ frequencyCapPerHour: 5, frequencyCapPerDay: 50 }, 3, 40)).toBe(
      true,
    );
  });

  it('blocks when hour count reaches the per-hour cap', () => {
    expect(isUnderFrequencyCap({ frequencyCapPerHour: 5 }, 5, 10)).toBe(false);
  });

  it('blocks when day count reaches the per-day cap', () => {
    expect(isUnderFrequencyCap({ frequencyCapPerHour: 5, frequencyCapPerDay: 50 }, 2, 50)).toBe(
      false,
    );
  });

  it('treats a 0 or null cap as unlimited', () => {
    expect(isUnderFrequencyCap({ frequencyCapPerHour: 0, frequencyCapPerDay: 0 }, 999, 999)).toBe(
      true,
    );
    expect(
      isUnderFrequencyCap({ frequencyCapPerHour: null, frequencyCapPerDay: null }, 999, 999),
    ).toBe(true);
  });
});
