import { LedgerStatus } from '@waitlayer/shared';

/** Valid earning state transitions */
export const EARNING_TRANSITIONS: Partial<Record<LedgerStatus, LedgerStatus[]>> = {
  [LedgerStatus.ESTIMATED]: [
    LedgerStatus.PENDING,
    LedgerStatus.CONFIRMED,
    LedgerStatus.HELD,
    LedgerStatus.REVERSED,
    LedgerStatus.VOID,
  ],
  [LedgerStatus.PENDING]: [
    LedgerStatus.CONFIRMED,
    LedgerStatus.HELD,
    LedgerStatus.REVERSED,
    LedgerStatus.VOID,
  ],
  [LedgerStatus.CONFIRMED]: [
    LedgerStatus.HELD,
    LedgerStatus.PAID,
    LedgerStatus.REVERSED,
    LedgerStatus.VOID,
  ],
  [LedgerStatus.HELD]: [LedgerStatus.CONFIRMED, LedgerStatus.REVERSED, LedgerStatus.VOID],
  [LedgerStatus.PAID]: [],
  [LedgerStatus.REVERSED]: [],
  [LedgerStatus.VOID]: [],
};
export const PLATFORM_BUCKETS = {
  PLATFORM_FEE: 'platform_fee',
  FRAUD_RESERVE: 'fraud_reserve',
  // Cash received from advertisers' deposits on the configured money-in rail
  // (Stripe or Dodo). Every advertiser deposit credits this bucket (status
  // 'confirmed') so the platform's books reflect the inbound cash side of the
  // double entry — paired with the advertiser `credit` row written in the
  // corresponding deposit webhook (Stripe or Dodo). Without it the platform's
  // cash position is invisible in the ledger and reconciliations against the
  // provider balance can't be performed.
  CASH: 'cash',
  // Referral bonuses are platform-funded developer earnings credits. Every
  // processReferralRewards call writes a platformLedger credit in this bucket
  // paired with an earningsLedger credit for the referrer. The global
  // money-integrity invariant must account for this bucket so that a referral
  // payout (which increases netEarnings without touching advertiser/platform
  // fee/fraud-reserve/cash) doesn't create a permanent reconciliation
  // discrepancy.
  REFERRAL_BONUS: 'referral_bonus',
} as const;
