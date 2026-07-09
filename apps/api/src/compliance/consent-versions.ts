// Current policy/terms versions users must have consented to. Bump these
// strings whenever the privacy policy / terms / cookie notice materially
// change. Auth signup and the re-prompt flow both consume this file so signup
// cannot drift from the server-owned required versions.
export const CURRENT_CONSENT_VERSIONS = {
  privacy_policy: '2026-07-01',
  terms_of_service: '2026-07-01',
  marketing_cookies: '2026-07-01',
} as const;

export const SIGNUP_CONSENT_PURPOSES = ['terms_of_service', 'privacy_policy'] as const;

export type SignupConsentPurpose = typeof SIGNUP_CONSENT_PURPOSES[number];
