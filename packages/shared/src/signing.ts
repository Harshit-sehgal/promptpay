import * as crypto from 'crypto';

/**
 * Produce a canonical JSON string with sorted keys for deterministic signing.
 * The backend uses: JSON.stringify(payload, Object.keys(payload).sort())
 * All clients MUST use this same canonical form before HMAC signing.
 */
export function canonicalJson(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/**
 * Sign a payload object with HMAC-SHA256, returning the hex digest.
 * This signs the canonical form (sorted keys), not raw JSON.stringify.
 */
export function signPayload(payload: Record<string, unknown>, secret: string): string {
  const canonical = canonicalJson(payload);
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature against a payload using timing-safe comparison.
 * Returns true if the signature matches the expected value.
 */
export function verifySignature(
  payload: Record<string, unknown>,
  secret: string,
  signature: string,
): boolean {
  const expected = signPayload(payload, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}