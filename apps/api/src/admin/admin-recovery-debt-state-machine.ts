import { BadRequestException } from '@nestjs/common';

import { RecoveryDebtCaseStatus } from '@waitlayer/db';

/**
 * Declarative RecoveryDebtCase lifecycle (P2.2 — unified state machine).
 *
 *   open ─┬─▶ in_collections ─┬─▶ recovered (terminal)
 *         │                  ├─▶ written_off (terminal)
 *         │                  └─▶ closed (terminal)
 *         ├─▶ recovered
 *         ├─▶ written_off
 *         └─▶ closed
 *
 * `open` and `in_collections` are the only ACTIVE states; either may be
 * resolved to a terminal state, and an active case may be re-classified
 * between `open` and `in_collections` (escalate / de-escalate). Terminal
 * states are terminal.
 */
export const RECOVERY_DEBT_TRANSITIONS: Record<RecoveryDebtCaseStatus, RecoveryDebtCaseStatus[]> = {
  [RecoveryDebtCaseStatus.open]: [
    RecoveryDebtCaseStatus.in_collections,
    RecoveryDebtCaseStatus.recovered,
    RecoveryDebtCaseStatus.written_off,
    RecoveryDebtCaseStatus.closed,
  ],
  [RecoveryDebtCaseStatus.in_collections]: [
    RecoveryDebtCaseStatus.open,
    RecoveryDebtCaseStatus.recovered,
    RecoveryDebtCaseStatus.written_off,
    RecoveryDebtCaseStatus.closed,
  ],
  [RecoveryDebtCaseStatus.recovered]: [],
  [RecoveryDebtCaseStatus.written_off]: [],
  [RecoveryDebtCaseStatus.closed]: [],
};

/**
 * Validate a RecoveryDebtCase status transition against RECOVERY_DEBT_TRANSITIONS.
 * Throws BadRequestException for any transition not enumerated in the table
 * (including resolving a terminal case).
 */
export function validateRecoveryDebtTransition(
  from: RecoveryDebtCaseStatus,
  to: RecoveryDebtCaseStatus,
): void {
  const allowed = RECOVERY_DEBT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid recovery debt transition: ${from} → ${to}. Allowed targets from '${from}': ${allowed?.join(', ') || 'none'}`,
    );
  }
}
