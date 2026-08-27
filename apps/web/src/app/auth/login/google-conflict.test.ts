import { describe, expect, it } from 'vitest';

/**
 * These mirror the two helpers on the login page. They exist because the
 * behaviour they guard is a security boundary, not a cosmetic one: the API
 * deliberately refuses to link Google to a pre-existing password account by
 * email alone, and the UI must route the visitor to the explicit link flow
 * rather than paper over the refusal.
 */
function emailFromIdToken(credential: string): string | null {
  try {
    const payload = credential.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claim = (JSON.parse(json) as { email?: unknown }).email;
    return typeof claim === 'string' ? claim : null;
  } catch {
    return null;
  }
}

function isExistingAccountConflict(message: string): boolean {
  return /account with this email already exists/i.test(message);
}

const token = (payload: object) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('Google sign-in conflict recovery', () => {
  it('recognises the API refusal so the visitor can be guided', () => {
    expect(
      isExistingAccountConflict(
        'An account with this email already exists. Sign in with your password and link Google from your account settings.',
      ),
    ).toBe(true);
  });

  it('does not swallow unrelated failures', () => {
    expect(isExistingAccountConflict('Invalid Google ID token')).toBe(false);
    expect(isExistingAccountConflict('Google account email is not verified')).toBe(false);
    expect(isExistingAccountConflict('Upstream API unavailable')).toBe(false);
  });

  it('reads the email claim so the form can be prefilled', () => {
    expect(emailFromIdToken(token({ email: 'someone@example.com', sub: '1' }))).toBe(
      'someone@example.com',
    );
  });

  /**
   * The token is unverified at this point — the API verifies it. A malformed or
   * hostile value must degrade to "no prefill", never throw and break the page.
   */
  it.each(['', 'not-a-jwt', 'a.b', 'a.%%%.c', 'header..sig'])(
    'returns null for a malformed credential (%s)',
    (bad) => {
      expect(emailFromIdToken(bad)).toBeNull();
    },
  );

  it('returns null when the claim is absent or not a string', () => {
    expect(emailFromIdToken(token({ sub: '1' }))).toBeNull();
    expect(emailFromIdToken(token({ email: 42 }))).toBeNull();
  });
});
