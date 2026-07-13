import { createHmac } from 'crypto';

const TEST_FALLBACK_KEY = 'waitlayer-test-privacy-hash-key-at-least-32-chars';

/**
 * Stable, purpose-separated pseudonymization for low-entropy identifiers.
 * HMAC prevents reversing IPv4-sized input spaces without the server key.
 */
export function privacyPseudonym(value: string, purpose: string): string {
  const key = process.env.PRIVACY_HASH_KEY;
  if ((!key || key.length < 32) && process.env.NODE_ENV === 'production') {
    throw new Error('PRIVACY_HASH_KEY must be set to a 32+ character secret in production');
  }
  return createHmac('sha256', key || TEST_FALLBACK_KEY)
    .update(`waitlayer-privacy-v1:${purpose}:${value}`)
    .digest('hex');
}
