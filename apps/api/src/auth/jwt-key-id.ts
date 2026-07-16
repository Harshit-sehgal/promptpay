import { createHash } from 'crypto';

/**
 * Derive a stable key ID from the JWT public key. The same public key always
 * produces the same kid, allowing clients to match a token's `kid` header to
 * the corresponding JWKS key and enabling zero-downtime key rotation.
 *
 * The input is trimmed before hashing so the kid is stable regardless of how
 * the PEM was loaded (dotenv may keep a trailing newline; `$(cat …)` strips
 * it; a file read may or may not). Without trimming, the signing and
 * verification sides could derive different kids for the same key and every
 * token would fail verification.
 */
export function deriveKeyId(publicKey: string): string {
  return createHash('sha256').update(publicKey.trim()).digest('hex').slice(0, 16);
}
