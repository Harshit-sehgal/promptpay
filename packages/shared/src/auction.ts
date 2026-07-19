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
 *   2. Pick one currency group with probability **proportional to the number
 *      of eligible campaigns it contains** (bounded bigint sampling over the
 *      sum of eligible-campaign counts). This is the cross-currency
 *      arbitration: it NEVER compares raw minor units across currencies, so
 *      `100 JPY` cannot compete as equal to `100 USD cents`. Selection is
 *      weighted over currency GROUPS by campaign *count* (not by bid
 *      magnitude), so a sparse currency (one campaign) can no longer buy
 *      equal inventory share to a dense one — an advertiser cannot game
 *      inventory by choosing a currency with few competing campaigns.
 *
 *      Known limitation: group weighting is by eligible-campaign count only
 *      and is NOT tied to the requesting user's country or preferred
 *      currency (no geo). Adding geo is explicitly out of scope here.
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
  // Mask the sampled value to exactly `bitLen` low bits so the sample space is
  // [0, 2^bitLen) — a power of two >= maxExclusive. Rejection sampling over a
  // power-of-two range yields a perfectly uniform result over [0, maxExclusive)
  // (every accepted value has exactly one representation), fixing the old
  // "sample a full byte then reject" bias that over-weighted some buckets for
  // small bounds (e.g. maxExclusive = 3) and the modulo fallback's bias.
  const mask = (1n << BigInt(bitLen)) - 1n;
  for (let attempt = 0; attempt < 64; attempt++) {
    const bytes = crypto.randomBytes(byteLen);
    let value = 0n;
    for (let i = 0; i < byteLen; i++) {
      value = (value << 8n) | BigInt(bytes[i]);
    }
    value &= mask;
    if (value < maxExclusive) return value;
  }
  // Fallback (effectively never reached): only triggers after 64 independent
  // rejections, which is astronomically unlikely for any realistic bound.
  const bytes = crypto.randomBytes(byteLen);
  let value = 0n;
  for (let i = 0; i < byteLen; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  value &= mask;
  return value < maxExclusive ? value : value % maxExclusive;
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
 *  - When multiple currencies are eligible, one currency group is chosen with
 *    probability proportional to the number of eligible campaigns it contains
 *    (bounded bigint sampling over the total eligible-campaign count), NOT
 *    uniformly and NOT by bid magnitude. This stops sparse-currency gaming
 *    while keeping determinism (identical inputs + identical draws => same
 *    group).
 */
export function selectCampaignIndex<T extends CampaignBid>(
  campaigns: T[],
  options: SelectCampaignOptions = {},
): number {
  if (campaigns.length === 0) return -1;
  if (campaigns.length === 1) return 0;

  const randomBelow = options.randomBelow ?? randomBigIntBelow;
  const groups = groupCampaignsByCurrency(campaigns);

  // Cross-currency arbitration: weight each currency group by the number of
  // eligible campaigns it contains (probability ∝ eligible-campaign count).
  // This removes the sparse-currency gaming vector — under the old
  // group-uniform pick a currency with a single campaign had the same overall
  // serving probability as a currency with hundreds, so an advertiser could
  // buy cheap inventory by choosing a sparse currency. Now a dense currency is
  // proportionally more likely to be served. Determinism is preserved:
  // identical eligible set + identical RNG draws => identical group picked.
  // KNOWN LIMITATION: this is NOT tied to the user's country or preferred
  // currency (no geo) — out of scope here.
  const sizes = groups.map((g) => BigInt(g.indices.length));
  const totalEligible = sizes.reduce((sum, n) => sum + n, 0n);
  const groupDraw = randomBelow(totalEligible);
  let acc = 0n;
  let group = groups[groups.length - 1];
  for (let i = 0; i < groups.length; i++) {
    acc += sizes[i];
    if (groupDraw < acc) {
      group = groups[i];
      break;
    }
  }
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
