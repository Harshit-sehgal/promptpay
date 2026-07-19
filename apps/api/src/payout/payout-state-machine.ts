import { BadRequestException } from '@nestjs/common';

import { PayoutStatus } from '@waitlayer/shared';

/**
 * Declarative PayoutRequest lifecycle.
 *
 *  draft ─▶ requested ─▶ under_review ─┬─▶ approved ─▶ processing ─┬─▶ paid
 *                                      └─▶ rejected (terminal)                  └─▶ failed (terminal)
 *
 *  approved / processing are the only pre-states from which a payout may be
 *  marked paid or failed (see markPayoutPaid / markPayoutFailed). `draft`,
 *  `rejected`, `cancelled`, `paid` and `failed` are terminal (or only exit via
 *  the explicit create → requested hop for `draft`). `under_review` may be
 *  approved or rejected; an approved payout may only enter `processing`.
 */
export const PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  [PayoutStatus.DRAFT]: [PayoutStatus.REQUESTED],
  [PayoutStatus.REQUESTED]: [PayoutStatus.UNDER_REVIEW],
  [PayoutStatus.UNDER_REVIEW]: [PayoutStatus.APPROVED, PayoutStatus.REJECTED],
  [PayoutStatus.APPROVED]: [PayoutStatus.PROCESSING, PayoutStatus.PAID, PayoutStatus.FAILED],
  [PayoutStatus.REJECTED]: [],
  [PayoutStatus.PROCESSING]: [PayoutStatus.PAID, PayoutStatus.FAILED],
  [PayoutStatus.PAID]: [],
  [PayoutStatus.FAILED]: [],
  [PayoutStatus.CANCELLED]: [],
};

/**
 * Validate a PayoutRequest status transition against PAYOUT_TRANSITIONS.
 *
 * Throws a BadRequestException for any transition not enumerated in the table
 * (including a non-terminal → non-terminal hop that isn't explicitly allowed).
 * Callers remain responsible for the atomic CAS `updateMany where status in (…)`
 * guard; this is the declarative, human-readable pre-check layered in front of
 * it.
 */
export function validatePayoutTransition(from: PayoutStatus, to: PayoutStatus): void {
  const allowed = PAYOUT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid payout transition: ${from} → ${to}. Allowed targets from '${from}': ${allowed?.join(', ') || 'none'}`,
    );
  }
}
