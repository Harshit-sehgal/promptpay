export interface PayoutAmountSource {
  requestedAmountMinor: bigint;
  approvedAmountMinor?: bigint | null;
}

export function authoritativePayoutAmountMinor(payout: PayoutAmountSource): bigint {
  return payout.approvedAmountMinor ?? payout.requestedAmountMinor;
}

// Currency-aware helpers re-exported from @waitlayer/shared so the admin payout
// modals respect each currency's real minor-unit exponent instead of assuming
// 2 decimals (issue A-031 — JPY / 0-decimal currencies were mis-displayed by
// the old hardcoded /100 path).
export { majorToMinor, minorToMajorInputValue } from '@waitlayer/shared';
