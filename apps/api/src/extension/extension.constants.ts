import * as crypto from 'crypto';

export class BudgetExhaustedError extends Error {
  constructor() {
    super('Campaign budget exhausted or campaign inactive');
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * Thrown when an advertiser's account-level (per-currency) spendable balance
 * is insufficient to cover a billable event, detected INSIDE the locked billing
 * transaction (issue A-055). The caller rolls back the transaction and marks
 * the impression/click as not billable with reason
 * 'insufficient_advertiser_balance'.
 */
export class AdvertiserBalanceExhaustedError extends Error {
  constructor() {
    super('Advertiser balance exhausted');
    this.name = 'AdvertiserBalanceExhaustedError';
  }
}

/**
 * Deterministic 32-bit advisory lock key for an (advertiserId, currency) pair.
 * Used to serialize all billing writes for the same advertiser+currency so two
 * concurrent campaigns cannot both read the same pre-bill balance and overdraw
 * the advertiser's account (issue A-055).
 */
export function advertiserCurrencyLockKey(advertiserId: string, currency: string): bigint {
  return BigInt(
    '0x' +
      crypto
        .createHash('sha256')
        .update(`adv:${advertiserId}:${currency}`)
        .digest('hex')
        .slice(0, 8),
  );
}

/**
 * When the extension reports a wait_state_end, its claimed duration must
 * agree with the server-computed delta from the matching start event.
 * Network-and-scheduling latency and small clock skew are tolerated; this
 * constant sets the maximum tolerable drift in seconds. Anything larger is
 * treated as tampering and the request is rejected.
 */
export const WAIT_STATE_DURATION_TOLERANCE_SECONDS = 30;

/** Hard cap on a single wait_state duration (24 hours). */
export const WAIT_STATE_MAX_DURATION_SECONDS = 86400;

/** Max retries on a serializable transaction conflict (PostgreSQL serialization failure). */
export const FREQUENCY_CAP_TXN_MAX_RETRIES = 3;

export interface ServedAd {
  impressionToken: string;
  campaignId: string;
  creativeId: string;
  title: string;
  message: string;
  label: string;
  displayDomain: string;
  destinationUrl: string;
  ctaText: string | null;
}

export function hasMatchingSecret(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export function hashDeviceRecoveryToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Ad-request cache keys. They MUST be namespaced by (userId, deviceId) so that
 * a client-generated `waitStateId` or `idempotencyKey` collision between two
 * users cannot leak one user's served ad / impression token to the other
 * (issue A-038). Exported for unit testing the scoping.
 */
export function adCacheKey(userId: string, deviceId: string, waitStateId: string): string {
  return `${userId}:${deviceId}:${waitStateId}`;
}

export function adIdempotencyCacheKey(
  userId: string,
  deviceId: string,
  idempotencyKey: string,
): string {
  return `${userId}:${deviceId}:${idempotencyKey}`;
}

/**
 * Merge a developer's PERSISTED blocked categories (stored on UserSettings)
 * with any per-request client-supplied array (issue A-057). Server-side
 * enforcement is the source of truth — a client omission cannot relax a
 * developer preference. The union of the two blocked sets means a category
 * blocked on either side is excluded. Exported for focused unit testing.
 */
export function mergeBlockedCategories(
  persisted: string[] | undefined,
  requested?: string[] | null,
): string[] {
  const persistedBlocked = persisted ?? [];
  if (requested && requested.length > 0) {
    return Array.from(new Set([...persistedBlocked, ...requested]));
  }
  return persistedBlocked;
}

/**
 * True when the given campaign category is present in the effective blocked
 * set. Exact-match only — a typo'd or differently-cased preference does not
 * suppress an unrelated category (issue A-057). Exported for unit testing.
 */
export function isCategoryBlocked(blocked: string[], category: string): boolean {
  return blocked.length > 0 && blocked.includes(category);
}
