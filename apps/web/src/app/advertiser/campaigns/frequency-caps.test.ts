import { describe, expect, it } from 'vitest';

import { FREQUENCY_CAPS, frequencyCapValueToInput, parseFrequencyCapInput } from './frequency-caps';

describe('campaign frequency cap input parsing (A-073)', () => {
  it('treats blank input as leave unchanged', () => {
    expect(parseFrequencyCapInput('', FREQUENCY_CAPS.perHour)).toEqual({});
    expect(parseFrequencyCapInput('   ', FREQUENCY_CAPS.perDay)).toEqual({});
  });

  it('accepts valid min and max values', () => {
    expect(parseFrequencyCapInput('1', FREQUENCY_CAPS.perHour)).toEqual({ value: 1 });
    expect(parseFrequencyCapInput('30', FREQUENCY_CAPS.perHour)).toEqual({ value: 30 });
    expect(parseFrequencyCapInput('100', FREQUENCY_CAPS.perDay)).toEqual({ value: 100 });
  });

  it('rejects zero and over-limit values before the API sees them', () => {
    expect(parseFrequencyCapInput('0', FREQUENCY_CAPS.perHour).error).toContain('between 1 and 30');
    expect(parseFrequencyCapInput('31', FREQUENCY_CAPS.perHour).error).toContain(
      'between 1 and 30',
    );
    expect(parseFrequencyCapInput('101', FREQUENCY_CAPS.perDay).error).toContain(
      'between 1 and 100',
    );
  });

  it('rejects non-integer input instead of silently omitting it', () => {
    expect(parseFrequencyCapInput('abc', FREQUENCY_CAPS.perHour).error).toContain('whole number');
    expect(parseFrequencyCapInput('1.5', FREQUENCY_CAPS.perDay).error).toContain('whole number');
  });

  it('formats existing API values for prefilled inputs', () => {
    expect(frequencyCapValueToInput(2)).toBe('2');
    expect(frequencyCapValueToInput(6)).toBe('6');
    expect(frequencyCapValueToInput(null)).toBe('');
    expect(frequencyCapValueToInput(undefined)).toBe('');
  });
});
