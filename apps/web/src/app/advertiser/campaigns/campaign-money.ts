import {
  campaignMaximumBudgetMinor,
  campaignMinimumBidMinor,
  campaignMinimumBudgetMinor,
  formatMinorUnits,
  majorToMinor,
  minorToMajorInputValue,
} from '@waitlayer/shared';

/**
 * Per-currency campaign money-policy for web input forms. Reads the
 * authoritative per-currency thresholds from CURRENCY_POLICY (the single
 * source of truth) rather than re-applying the USD-shaped global constants —
 * so JPY's ¥7,500 minimum is not accidentally rendered as a `$50` floor.
 */
export function campaignMoneyInputPolicy(currency: string) {
  const minorUnitStep = minorToMajorInputValue(1n, currency);
  const minBudget = campaignMinimumBudgetMinor(currency);
  const maxBudget = campaignMaximumBudgetMinor(currency);
  const minBid = campaignMinimumBidMinor(currency);

  return {
    minorUnitStep,
    minimumBid: minorToMajorInputValue(minBid, currency),
    minimumBudget: minorToMajorInputValue(minBudget, currency),
    maximumBudget: minorToMajorInputValue(maxBudget, currency),
    minimumBudgetLabel: formatMinorUnits(minBudget, currency),
  };
}

/**
 * Parse a user-entered campaign amount into exact minor units. Uses the
 * exact decimal parser (`majorToMinor`) instead of `Number(value)` so values
 * above Number.MAX_SAFE_INTEGER and non-2-decimal currencies (JPY/BHD) are
 * handled exactly. Returns null for empty input; throws are surfaced by the
 * caller. Malformed input (excess decimals, exponent notation, commas)
 * yields null rather than a silently-rounded wrong amount.
 */
export function parseCampaignAmountMinor(value: string, currency: string): bigint | null {
  if (!value.trim()) return null;
  try {
    return majorToMinor(value, currency);
  } catch {
    return null;
  }
}
