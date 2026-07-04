import * as crypto from 'crypto';

/** Sort an object's keys recursively so nested objects also serialize stably.
 *  `JSON.stringify(obj, Object.keys(obj).sort())` only sorts the TOP-LEVEL keys
 *  — `JSON.stringify` applies the replacer's second arg as a property filter,
 *  but the order is determined per call by the top-level keys alone, so nested
 *  objects serialize in their property insertion order. Two clients building
 *  the same logical payload with different nested-object key order would
 *  produce different canonical strings and signatures would diverge. */
function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted as unknown as T;
  }
  return value;
}

/**
 * Produce a canonical JSON string with recursively sorted keys for deterministic
 * signing.
 */
export function canonicalJson(payload: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(payload));
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
  // Decode as hex — signatures are produced via .digest('hex') so any
  // non-hex string would produce a buffer of mismatched UTF-8 length and
  // fall through to `length !== expBuf.length` → false. Earlier versions
  // used Buffer.from(signature) with the default UTF-8 encoding, which let
  // a non-hex garbage input silently decode to a different-length buffer
  // and produce an opaque length-mismatch failure rather than the intended
  // clean rejection.
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = Buffer.from(signature, 'hex');
    expBuf = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}