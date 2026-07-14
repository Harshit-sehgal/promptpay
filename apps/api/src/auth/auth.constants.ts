import { SignupConsentPurpose } from '../compliance/consent-versions';

export interface TokenPayload {
  sub: string;
  role: string;
  family?: string;
  jti?: string;
  aud?: string | string[];
  /** Unix timestamp (seconds) of the most recent MFA proof in this token chain. */
  mfaAt?: number;
}

export interface AccessTokenPayload {
  sub: string;
  role: string;
  jti: string;
  aud: string | string[];
  iss?: string;
  family?: string;
  mfaAt?: number;
}

export interface EmailVerificationPayload {
  sub: string;
  email: string;
  action: string;
}

export interface PasswordResetPayload {
  sub: string;
  action: string;
  /** Fingerprint of the password hash at issue time — invalidates the token once the password changes */
  fp: string;
}

export type SignupConsentVersions = Record<SignupConsentPurpose, string>;

export type SignupConsentMethod = 'signup' | 'google_signup';

export type SignupConsentRecord = {
  id: string;
  purpose: string;
  version: string;
};

/**
 * Check whether a JWT audience claim (string or array) includes a given
 * value. This centralises the type handling so callers don't need to repeat
 * typeof checks across the auth traits.
 */
export function audienceIncludes(aud: string | string[] | undefined, value: string): boolean {
  if (!aud) return false;
  return typeof aud === 'string' ? aud === value : aud.includes(value);
}
