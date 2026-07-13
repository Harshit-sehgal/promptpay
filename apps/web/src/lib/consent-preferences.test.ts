import { beforeEach, describe, expect, it } from 'vitest';

import {
  COOKIE_CONSENT_STORAGE_KEY,
  hasCurrentMarketingConsent,
  readStoredCookieConsent,
  writeStoredCookieConsent,
} from './consent-preferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe('cookie consent preferences', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('accepts only an accepted choice at the exact required version', () => {
    writeStoredCookieConsent('accepted', '2026-07-13', storage);
    expect(hasCurrentMarketingConsent('2026-07-13', storage)).toBe(true);
    expect(hasCurrentMarketingConsent('2026-08-01', storage)).toBe(false);
  });

  it.each([
    { choice: 'declined', version: '2026-07-13' },
    { choice: 'accepted', version: null },
  ] as const)('does not authorize telemetry for $choice / $version', ({ choice, version }) => {
    writeStoredCookieConsent(choice, version, storage);
    expect(hasCurrentMarketingConsent('2026-07-13', storage)).toBe(false);
  });

  it('rejects malformed and legacy stored values', () => {
    storage.values.set(COOKIE_CONSENT_STORAGE_KEY, '{broken');
    expect(readStoredCookieConsent(storage)).toBeNull();
    storage.values.set(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ choice: 'maybe' }));
    expect(readStoredCookieConsent(storage)).toBeNull();
  });
});
