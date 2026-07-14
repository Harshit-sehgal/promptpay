import { createHash } from 'crypto';

/**
 * Derive a stable key ID from the JWT public key. The same public key always
 * produces the same kid, allowing clients to match a token's `kid` header to
 * the corresponding JWKS entry and enabling zero-downtime key rotation.
 */
export function deriveKeyId(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
}
