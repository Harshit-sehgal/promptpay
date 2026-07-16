import { FraudFlagStatus } from '@waitlayer/db';

/** Fraud-review states that remain active until an operator resolves the flag. */
export const ACTIVE_FRAUD_FLAG_STATUSES: FraudFlagStatus[] = [
  FraudFlagStatus.open,
  FraudFlagStatus.reviewing,
  FraudFlagStatus.escalated,
];

/** Shared advisory-lock namespace for fraud creation vs payout initiation. */
export function payoutFraudLockKey(userId: string): string {
  return `payout-fraud:${userId}`;
}
