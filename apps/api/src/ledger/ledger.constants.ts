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
  // Cash received from advertisers' Stripe deposits. Every advertiser deposit
  // credits this bucket (status 'confirmed') so the platform's books reflect
  // the inbound cash side of the double entry — paired with the advertiser
  // `credit` row written in the Stripe webhook. Without it the platform's
  // cash position is invisible in the ledger and reconciliations against
  // Stripe balance can't be performed.
  CASH: 'cash',
} as const;
