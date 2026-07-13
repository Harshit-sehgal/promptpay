export const COOKIE_CONSENT_STORAGE_KEY = 'wl_cookie_consent';

export type CookieConsentChoice = 'accepted' | 'declined';

export interface StoredCookieConsent {
  choice: CookieConsentChoice;
  at: string;
  version: string | null;
}

export function readStoredCookieConsent(
  storage?: Pick<Storage, 'getItem'>,
): StoredCookieConsent | null {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return null;
  const raw = target.getItem(COOKIE_CONSENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCookieConsent>;
    if (parsed.choice !== 'accepted' && parsed.choice !== 'declined') return null;
    return {
      choice: parsed.choice,
      at: typeof parsed.at === 'string' ? parsed.at : '',
      version: typeof parsed.version === 'string' ? parsed.version : null,
    };
  } catch {
    return null;
  }
}

export function writeStoredCookieConsent(
  choice: CookieConsentChoice,
  version: string | null,
  storage?: Pick<Storage, 'setItem'>,
): StoredCookieConsent {
  const value: StoredCookieConsent = { choice, at: new Date().toISOString(), version };
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  target?.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(value));
  return value;
}

export function hasCurrentMarketingConsent(
  requiredVersion: string,
  storage?: Pick<Storage, 'getItem'>,
): boolean {
  const stored = readStoredCookieConsent(storage);
  return stored?.choice === 'accepted' && stored.version === requiredVersion;
}
