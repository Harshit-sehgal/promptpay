export interface PayoutAmountSource {
  requestedAmountMinor: number;
  approvedAmountMinor?: number | null;
}

export function authoritativePayoutAmountMinor(payout: PayoutAmountSource): number {
  return payout.approvedAmountMinor ?? payout.requestedAmountMinor;
}

export function minorToMajorInputValue(amountMinor: number): string {
  const major = amountMinor / 100;
  return Number.isInteger(major) ? major.toString() : major.toFixed(2);
}
