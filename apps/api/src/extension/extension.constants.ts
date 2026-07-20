import * as crypto from 'crypto';

// ── Wait-detection confidence scoring ──
//
// These constants and the computeWaitConfidence function live here (rather
// than in extension-wait.trait.ts) so that modules outside the extension
// subsystem (e.g. the health controller's monitoring metrics) can import
// MINIMUM_WAIT_CONFIDENCE without pulling in the trait class and its
// transitive NestJS/Prisma dependencies. The trait file re-exports them
// for backward compatibility with existing import sites.

/**
 * Weighted confidence scoring for wait-state signals. The strongest
 * positive signal dominates (max-weight) rather than summing, so a single
 * high-confidence signal (e.g. an active AI generation) is not diluted by
 * incidental inactivity telemetry.
 *
 * `lifecycle_event` is weighted BELOW the billing threshold (0.45 < 0.5)
 * because lifecycle events are ambiguous: a build completion IS a wait, but
 * a window focus change or tab switch is NOT. A single lifecycle event
 * alone cannot trigger billing; it must be accompanied by another signal
 * (e.g. command_execution for a build, active_task for a running process).
 */
export const SIGNAL_WEIGHTS: Record<string, number> = {
  ai_generation: 0.95,
  active_task: 0.85,
  command_execution: 0.7,
  lifecycle_event: 0.45,
  inactivity: 0.05,
};

/** Minimum confidence for a wait state to be eligible for ad serving. */
export const MINIMUM_WAIT_CONFIDENCE = 0.5;

export interface WaitSignal {
  type: keyof typeof SIGNAL_WEIGHTS;
  details?: string;
}

export interface WaitClassification {
  /** The wait state was recorded (any non-empty signal set). */
  detected: boolean;
  /** Sufficient confidence to serve a targeted ad. */
  adEligible: boolean;
  /** Sufficient corroboration + verified source to credit the developer. */
  paymentEligible: boolean;
  /** Max-weight signal score (diagnostic only). */
  confidence: number;
  /** The dominant signal type used for the score. */
  reason: string;
  /** True if the detector source is NOT on the verified allowlist. */
  unverifiedSource: boolean;
}

/** Signals that can be the primary evidence a real productive wait occurred. */
const PRIMARY_SIGNALS: readonly string[] = ['ai_generation', 'active_task', 'command_execution'];

/**
 * Compute the wait-confidence from a set of signals. Returns the max-weight
 * signal's weight as the confidence and the signal type as the reason.
 * An empty signal set returns confidence 0 (no_signals).
 */
export function computeWaitConfidence(signals: WaitSignal[]): {
  confidence: number;
  reason: string;
} {
  if (!signals || signals.length === 0) {
    return { confidence: 0, reason: 'no_signals' };
  }
  let best = signals[0];
  let bestWeight = SIGNAL_WEIGHTS[best.type] ?? 0;
  for (const signal of signals) {
    const weight = SIGNAL_WEIGHTS[signal.type] ?? 0;
    if (weight > bestWeight) {
      best = signal;
      bestWeight = weight;
    }
  }
  return { confidence: bestWeight, reason: best.type };
}

/**
 * Classify a wait state into the three trusted-detection gates:
 *   - detected: any non-empty signal set
 *   - adEligible: max signal confidence >= MINIMUM_WAIT_CONFIDENCE
 *   - paymentEligible: adEligible AND at least one primary signal is
 *     corroborated by a second distinct signal category
 *
 * A modified client that forges a single `ai_generation` signal can still
 * get an ad served (ad gate), but it cannot earn money because the payment
 * gate requires corroboration from another signal category. This separates
 * "detected wait", "eligible for ad", and "eligible for payment".
 *
 * @param isVerifiedSource - whether the detector version/source is on the
 *   operator's verified allowlist. Unverified sources still serve ads if
 *   confidence is high enough, but earnings are held longer.
 */
export function classifyWaitState(
  signals: WaitSignal[],
  isVerifiedSource: boolean,
): WaitClassification {
  const { confidence, reason } = computeWaitConfidence(signals);

  if (!signals || signals.length === 0) {
    return {
      detected: false,
      adEligible: false,
      paymentEligible: false,
      confidence: 0,
      reason: 'no_signals',
      unverifiedSource: !isVerifiedSource,
    };
  }

  const uniqueTypes = new Set(signals.map((s) => s.type));
  const hasPrimary = [...uniqueTypes].some((t) => PRIMARY_SIGNALS.includes(t));
  const hasCorroboration = uniqueTypes.size >= 2;

  const adEligible = hasPrimary && confidence >= MINIMUM_WAIT_CONFIDENCE;
  const paymentEligible = adEligible && hasCorroboration;

  return {
    detected: true,
    adEligible,
    paymentEligible,
    confidence,
    reason,
    unverifiedSource: !isVerifiedSource,
  };
}

/**
 * Attestation helper: a detector source is considered verified only if its
 * version appears in the comma-separated `VERIFIED_DETECTOR_VERSIONS` env
 * variable. The empty/missing default treats all sources as unverified, which
 * is the safe fail-closed posture for an allowlist. Operators can enable a
 * known-good version by setting e.g. `VERIFIED_DETECTOR_VERSIONS=1.0.0,1.1.0`.
 */
export function isVerifiedDetectorSource(detectorVersion: string | null | undefined): boolean {
  if (!detectorVersion) return false;
  const allowlist = (process.env.VERIFIED_DETECTOR_VERSIONS ?? '').split(',').map((v) => v.trim());
  if (allowlist.length === 0 || (allowlist.length === 1 && allowlist[0] === '')) {
    return false;
  }
  return allowlist.includes(detectorVersion);
}

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
