import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks (https://standardwebhooks.com) signature verification.
 *
 * Dodo Payments signs webhooks per the Standard Webhooks specification (the
 * same scheme as Svix), NOT Stripe's `t=,v1=` header format. Three headers are
 * required and the signed content is `<webhook-id>.<webhook-timestamp>.<body>`:
 *
 *   webhook-id          — unique id for the delivery
 *   webhook-timestamp   — unix seconds at signing time
 *   webhook-signature   — space-separated list of `v1,<base64(hmac-sha256)>`
 *
 * The secret is a base64 key, optionally prefixed with `whsec_` (Dodo issues
 * secrets as `whsec_...`; the prefix is stripped before decoding).
 *
 * This is implemented here with `node:crypto` rather than the `standardwebhooks`
 * package so the deposit rail adds no dependency (the audit/license gates gate
 * every addition) and the verification is fully unit-testable.
 */
export const STANDARD_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface StandardWebhookHeaders {
  'webhook-id': string;
  'webhook-signature': string;
  'webhook-timestamp': string;
}

export interface VerifyStandardWebhookOptions {
  /** Raw request body (Buffer or utf-8 string). */
  payload: string | Buffer;
  /** The `whsec_`-prefixed or bare base64 secret. */
  secret: string;
  headers: StandardWebhookHeaders;
  /** Maximum clock skew, in seconds. Defaults to 5 minutes. */
  toleranceSeconds?: number;
}

/** Decode a `whsec_`-prefixed base64 secret to its raw key bytes, or null. */
function decodeSecret(secret: string): Buffer | null {
  const bare = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (!bare) return null;
  try {
    const key = Buffer.from(bare, 'base64');
    // A truncated/empty decode cannot produce a real HMAC key.
    if (key.length === 0) return null;
    return key;
  } catch {
    return null;
  }
}

/**
 * Verify a Standard Webhooks signature. Returns true only when a `v1` signature
 * matches (constant-time) AND the timestamp is within tolerance. Any missing
 * header, malformed timestamp, undecodable secret, or expired delivery returns
 * false — the caller must treat false as "unauthenticated".
 */
export function verifyStandardWebhookSignature(opts: VerifyStandardWebhookOptions): boolean {
  const id = opts.headers['webhook-id'];
  const signature = opts.headers['webhook-signature'];
  const timestampRaw = opts.headers['webhook-timestamp'];
  if (!id || !signature || !timestampRaw) return false;

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return false;

  const tolerance = opts.toleranceSeconds ?? STANDARD_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) return false;

  const key = decodeSecret(opts.secret);
  if (!key) return false;

  const body = Buffer.isBuffer(opts.payload) ? opts.payload.toString('utf8') : opts.payload;
  const signedContent = `${id}.${timestampRaw}.${body}`;
  const expected = createHmac('sha256', key).update(signedContent).digest();

  for (const candidate of signature.split(' ')) {
    const versionSeparator = candidate.indexOf(',');
    if (versionSeparator === -1) continue;
    const version = candidate.slice(0, versionSeparator);
    if (version !== 'v1') continue;
    const encoded = candidate.slice(versionSeparator + 1);
    if (!encoded) continue;

    let provided: Buffer;
    try {
      provided = Buffer.from(encoded, 'base64');
    } catch {
      continue;
    }
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) return true;
  }

  return false;
}
