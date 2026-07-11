import { describe, expect, it } from 'vitest';

import { isCountryEligible, normalizeCountryCode } from './country-targeting';

describe('normalizeCountryCode (A-056 / #3)', () => {
  it('trims and uppercases a valid code', () => {
    expect(normalizeCountryCode(' us ')).toBe('US');
  });
  it('rejects non-2-letter input', () => {
    expect(normalizeCountryCode('USA')).toBeUndefined();
    expect(normalizeCountryCode('')).toBeUndefined();
    expect(normalizeCountryCode(null)).toBeUndefined();
    expect(normalizeCountryCode(undefined)).toBeUndefined();
    expect(normalizeCountryCode('1A')).toBeUndefined();
  });
});

describe('isCountryEligible (A-056 / #3)', () => {
  it('serves everywhere with no rules', () => {
    expect(isCountryEligible({})).toBe(true);
    expect(isCountryEligible({ countryTargeting: [] })).toBe(true);
  });
  it('include-only: serves only listed countries, blocks unknown', () => {
    const campaign = {
      countryTargeting: [
        { countryCode: 'US', include: true },
        { countryCode: 'GB', include: true },
      ],
    };
    expect(isCountryEligible(campaign, 'US')).toBe(true);
    expect(isCountryEligible(campaign, 'DE')).toBe(false);
    expect(isCountryEligible(campaign, undefined)).toBe(false);
  });
  it('exclude-only: serves everywhere except listed; unknown allowed', () => {
    const campaign = { countryTargeting: [{ countryCode: 'US', include: false }] };
    expect(isCountryEligible(campaign, 'DE')).toBe(true);
    expect(isCountryEligible(campaign, 'US')).toBe(false);
    expect(isCountryEligible(campaign, undefined)).toBe(true);
  });
});
