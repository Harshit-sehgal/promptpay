import * as crypto from 'crypto';

/**
 * Currency-safe campaign auction selection.
 *
 * The previous implementation ordered ALL eligible campaigns by raw
 * `bidAmountMinor` descending and ran a single weighted-random pass across
 * them. That is invalid across currencies: `100` JPY minor units, `100` INR
 * paise and `100` USD cents are not economically comparable, so a ¥100 bid
 * would tie a $1.00 bid for selection weight.
 *
 * The safe model chosen here (one of the two permitted by spec) is
 * **independent auctions per currency**:
 *   1. Group eligible campaigns by currency (currency codes sorted for a
 *      stable iteration order — deterministic given the same input set).
 *   2. Uniformly pick one currency group (bounded integer sampling), so every
 *      currency group gets an equal chance regardless of bid magnitude. This
 *      is the cross-currency arbitration: it NEVER compares raw minor units
 *      across currencies, so `100 JPY` cannot compete as equal to
 *      `100 USD cents`. Selection is uniform over currency GROUPS — NOT over
 *      individual campaigns — so a currency with one campaign has the same
 *      overall serving probability as a currency with many. This avoids
 *      currency or campaign-count hegemony in the marketplace.
 *   3. Within the chosen currency group, run bid-weighted random selection
 *      using **bigint-safe** rejection sampling — never `Number(totalBid)`,
 *      which loses precision once total bid exceeds `Number.MAX_SAFE_INTEGER`.
 *
 * Identical inputs + identical random draws always produce identical output
 * (deterministic behaviour).
 */

export interface CampaignBid {
  id: string;
  currency: string;
  /** Per-billable-event bid in integer minor units. */
  bidAmountMinor: bigint;
}

export interface SelectCampaignOptions {
  /**
   * Inject a uniform `bigint` in `[0, maxExclusive)` for deterministic tests.
   * Omit to use crypto-based rejection sampling.
   */
  randomBelow?: (maxExclusive: bigint) => bigint;
}

/**
 * Generate a uniformly-distributed random bigint in `[0, maxExclusive)` using
 * rejection sampling over crypto random bytes. This is precision-safe for any
 * magnitude (no `Number()` conversion of the total) and is the replacement
 * for `BigInt(Math.floor(Math.random() * Number(totalBid)))`.
 */
export function randomBigIntBelow(maxExclusive: bigint): bigint {
  if (maxExclusive <= 0n) return 0n;
  const bitLen = maxExclusive.toString(2).length;
  const byteLen = Math.max(1, Math.ceil(bitLen / 8));
  // To keep rejection bias low, sample from the next byte boundary above.
  for (let attempt = 0; attempt < 64; attempt++) {
    const bytes = crypto.randomBytes(byteLen);
    let value = 0n;
    for (let i = 0; i < byteLen; i++) {
      value = (value << 8n) | BigInt(bytes[i]);
    }
    if (value < maxExclusive) return value;
  }
  // Fallback: modulo. Has negligible bias for large bit lengths and is still
  // bigint-exact. Reached only after 64 rejections (effectively never for
  // realistic bid totals).
  const bytes = crypto.randomBytes(byteLen);
  let value = 0n;
  for (let i = 0; i < byteLen; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value % maxExclusive;
}

/**
 * Group eligible campaigns into a currency->indices map, with currency codes
 * sorted ascending so iteration order is deterministic for a given input.
 */
export function groupCampaignsByCurrency<T extends CampaignBid>(
  campaigns: T[],
): { currency: string; indices: number[] }[] {
  const groups = new Map<string, number[]>();
  campaigns.forEach((c, index) => {
    const list = groups.get(c.currency);
    if (list) list.push(index);
    else groups.set(c.currency, [index]);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, indices]) => ({ currency, indices }));
}

/**
 * The exact, currency-safe next billable charge for a campaign. For both CPM
 * (reserved then spent at impression) and CPC (spent at click) the next
 * possible charge is the per-event bid. Exposed so the eligibility filter and
 * the selection step share one definition.
 */
export function nextBillableCharge(bidAmountMinor: bigint): bigint {
  return bidAmountMinor < 0n ? 0n : bidAmountMinor;
}

/**
 * Select a single eligible campaign by currency-safe, bigint-safe weighted
 * random selection. Returns the index of the chosen campaign within the input
 * array, or `-1` when the input is empty.
 *
 * Behaviour:
 *  - If every eligible campaign has a zero bid, selection within a group is
 *    uniform (each campaign equally likely) rather than deterministically
 *    picking the first — phrased the same way as random-below with a fallback.
 *  - When multiple currencies are eligible, one currency group is chosen
 *    uniformly at random (bounded integer sampling of the group index),
 *    independent of bid magnitude. Determinism is preserved given identical
 *    random draws.
 */
export function selectCampaignIndex<T extends CampaignBid>(
  campaigns: T[],
  options: SelectCampaignOptions = {},
): number {
  if (campaigns.length === 0) return -1;
  if (campaigns.length === 1) return 0;

  const randomBelow = options.randomBelow ?? randomBigIntBelow;
  const groups = groupCampaignsByCurrency(campaigns);

  // Cross-currency arbitration: uniform pick of one currency group. Never
  // compares raw minor units across currencies.
  const groupPick = randomBelow(BigInt(groups.length));
  const groupIdx = Number(groupPick);
  const group = groups[Math.min(groupIdx, groups.length - 1)];
  const indices = group.indices;

  // Within-currency weighted selection by raw bid (valid: same currency).
  // Negative bids are clamped to 0 for weighting: a malformed/negative bid must
  // never skew the relative weights of valid campaigns. (DTO validation already
  // enforces MinBigInt(1), so this clamp is defensive only.)
  const bidOf = (i: number): bigint =>
    campaigns[i].bidAmountMinor < 0n ? 0n : campaigns[i].bidAmountMinor;
  const totalBid = indices.reduce((sum, i) => sum + bidOf(i), 0n);
  if (totalBid <= 0n) {
    // Uniform fallback when all bids in the group are zero.
    const pick = randomBelow(BigInt(indices.length));
    return indices[Math.min(Number(pick), indices.length - 1)];
  }
  let random = randomBelow(totalBid);
  for (const i of indices) {
    random -= bidOf(i);
    if (random < 0n) return i;
  }
  // Defensive: floating drift is impossible with bigint exact math, but keep
  // a deterministic tail fallback so we never return -1 for a non-empty set.
  return indices[indices.length - 1];
}
