import { BadRequestException } from '@nestjs/common';

import { FraudFlagStatus } from '@waitlayer/db';

/** Fraud-review states that remain active until an operator resolves the flag. */
export const ACTIVE_FRAUD_FLAG_STATUSES: FraudFlagStatus[] = [
  FraudFlagStatus.open,
  FraudFlagStatus.reviewing,
  FraudFlagStatus.escalated,
];

/**
 * Declarative FraudFlag lifecycle.
 *
 *  open ─┬─▶ reviewing ─┬─▶ escalated ─┬─▶ resolved_valid   (terminal)
 *        │              └─▶ resolved_*  └─▶ resolved_invalid (terminal)
 *        └─▶ resolved_valid / resolved_invalid
 *
 *  `open` may move to `reviewing`, `escalated`, or be resolved directly.
 *  `reviewing` may escalate or resolve. `escalated` may only resolve.
 *  `resolved_valid` / `resolved_invalid` are terminal. (The spec's generic
 *  `resolved`/`dismissed` collapse onto the two concrete resolved outcomes the
 *  schema actually supports — there is no separate `dismissed` enum value.)
 */
export const FRAUD_FLAG_TRANSITIONS: Record<FraudFlagStatus, FraudFlagStatus[]> = {
  [FraudFlagStatus.open]: [
    FraudFlagStatus.reviewing,
    FraudFlagStatus.escalated,
    FraudFlagStatus.resolved_valid,
    FraudFlagStatus.resolved_invalid,
  ],
  [FraudFlagStatus.reviewing]: [
    FraudFlagStatus.escalated,
    FraudFlagStatus.resolved_valid,
    FraudFlagStatus.resolved_invalid,
  ],
  [FraudFlagStatus.escalated]: [FraudFlagStatus.resolved_valid, FraudFlagStatus.resolved_invalid],
  [FraudFlagStatus.resolved_valid]: [],
  [FraudFlagStatus.resolved_invalid]: [],
};

/**
 * Validate a FraudFlag status transition against FRAUD_FLAG_TRANSITIONS.
 *
 * Throws a BadRequestException for any transition not enumerated in the table.
 * Callers keep their atomic CAS `updateMany where status in
 * ACTIVE_FRAUD_FLAG_STATUSES` guard; this is the declarative pre-check layered
 * in front of it.
 */
export function validateFraudFlagTransition(from: FraudFlagStatus, to: FraudFlagStatus): void {
  const allowed = FRAUD_FLAG_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid fraud flag transition: ${from} → ${to}. Allowed targets from '${from}': ${allowed?.join(', ') || 'none'}`,
    );
  }
}

/** Shared advisory-lock namespace for fraud creation vs payout initiation. */
export function payoutFraudLockKey(userId: string): string {
  return `payout-fraud:${userId}`;
}
