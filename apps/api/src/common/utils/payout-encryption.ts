import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16;
const KEY_VERSION = 'v1';
const CURRENT_VERSION_PREFIX = `${KEY_VERSION}:`;

/**
 * Derive the encryption key from the configured PAYOUT_ENCRYPTION_KEY.
 * The key is expected as a base64-encoded 32-byte (256-bit) string.
 */
function loadEncryptionKey(): Buffer {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PAYOUT_ENCRYPTION_KEY must be set to a base64-encoded 256-bit key in production',
      );
    }
    // Dev/test fallback — deterministic, never used in production
    return Buffer.from(
      createHmac('sha256', 'payout-encryption-dev-fallback')
        .update('waitlayer-payout-encryption')
        .digest('hex')
        .slice(0, 32),
      'utf8',
    );
  }
  // Try base64 decode first; if it produces a valid 32-byte buffer, use it.
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // Not valid base64 — try raw string
  }
  // Raw 32+ char string: hash it to get a deterministic 256-bit key.
  return createHmac('sha256', 'payout-encryption-key-derivation').update(raw).digest();
}

/**
 * Encrypt a payout destination (email, Stripe account ID, etc.) using
 * AES-256-GCM with a random IV. Returns a version-prefixed, base64-encoded
 * string that can be stored in the `destination` column.
 *
 * Format: `v1:base64(iv + ciphertext + authTag)`
 */
export function encryptPayoutDestination(plaintext: string): string {
  const key = loadEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, Buffer.from(encrypted, 'base64'), authTag]);

  return `${CURRENT_VERSION_PREFIX}${combined.toString('base64')}`;
}

/**
 * Decrypt a version-prefixed, base64-encoded payout destination back to
 * plaintext. Supports key rotation by reading the version prefix and using
 * the appropriate key (currently only v1 is supported).
 */
export function decryptPayoutDestination(encrypted: string): string {
  const version = encrypted.split(':')[0];
  if (version !== 'v1') {
    throw new Error(`Unsupported payout encryption key version: ${version}`);
  }
  const raw = encrypted.slice(CURRENT_VERSION_PREFIX.length);
  const data = Buffer.from(raw, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);

  const key = loadEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, undefined as unknown as Buffer, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Compute a deterministic HMAC of a payout destination for duplicate/fraud
 * matching. This allows `checkSharedPayoutDestination` to detect shared
 * destinations without decrypting every account.
 *
 * The HMAC is stable (same input + same purpose → same output) so it can
 * be stored in the `destinationHmac` column and indexed.
 */
export function hmacPayoutDestination(destination: string): string {
  const key = loadEncryptionKey();
  return createHmac('sha256', key)
    .update(`waitlayer-payout-dest:v1:${destination.toLowerCase().trim()}`)
    .digest('hex');
}

/**
 * Mask a payout destination for display in UI and audit logs.
 * Preserves enough info for the user to recognize their own destination
 * while hiding the full value.
 *
 * Examples:
 *   'dev@example.com'       → 'dev***@example.com'
 *   'dev@sub.example.com'   → 'dev***@sub.example.com'
 *   'acct_1AbCdEfGhIjK'    → 'acct_***IjK'
 *   'manual-dest-wallet-001' → 'manual-***001'
 */
export function maskPayoutDestination(destination: string): string {
  if (!destination) return '';

  const trimmed = destination.trim();

  // Email: prefix***@domain
  const atIndex = trimmed.indexOf('@');
  if (atIndex > 0) {
    const prefix = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex);
    const visiblePrefix = prefix.length <= 3 ? prefix : prefix.slice(0, 3);
    return `${visiblePrefix}***${domain}`;
  }

  // Stripe Connect account: acct_***last4
  if (trimmed.startsWith('acct_') && trimmed.length > 8) {
    const last4 = trimmed.slice(-4);
    return `acct_***${last4}`;
  }

  // Generic: prefix***suffix (show first 6 chars + last 4 chars)
  if (trimmed.length > 12) {
    const prefix = trimmed.slice(0, 6);
    const suffix = trimmed.slice(-4);
    return `${prefix}***${suffix}`;
  }

  // Short strings: show only first 3 chars
  if (trimmed.length > 6) {
    return `${trimmed.slice(0, 3)}***`;
  }

  // Very short: fully masked
  return '***';
}

/**
 * Check if a string looks like an encrypted destination (starts with "v1:base64").
 */
export function isEncryptedDestination(destination: string): boolean {
  return destination.startsWith('v1:');
}
