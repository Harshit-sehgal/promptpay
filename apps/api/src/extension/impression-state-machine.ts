import { BadRequestException } from '@nestjs/common';

/**
 * Declarative AdImpression lifecycle (P2.2 — impression state machine).
 *
 *   served ─┬─▶ viewed ─┬─▶ clicked ─┬─▶ completed (terminal, billable)
 *           │           │            └─▶ failed    (terminal)
 *           │           └─▶ completed
 *           └─▶ clicked
 *   failed is terminal.
 *
 * NOTE — WIRING DEFERRED: the codebase does not currently persist a single
 * `AdImpression.status` column with these values. Impression progression is
 * recorded via `adImpression.create` (initial `served`) and `updateMany` hops
 * in `apps/api/src/extension/extension-ad.trait.ts`
 * (`claimImpression`, `recordImpressionRender`, `qualifyImpression`,
 * `registerClick`, `invalidateImpressionAndReleaseReservation`) which flip
 * `qualifiedAt` / `isBillable` / `invalidationReason` booleans instead of a
 * status enum. This machine is the canonical reference and is unit-tested;
 * guard the `status` writes here once an `AdImpression.status` column is
 * introduced (the above methods are the call sites to wire).
 */
export type ImpressionStatus = 'served' | 'viewed' | 'clicked' | 'completed' | 'failed';

export const IMPRESSION_TRANSITIONS: Record<ImpressionStatus, ImpressionStatus[]> = {
  served: ['viewed', 'clicked', 'failed'],
  viewed: ['clicked', 'completed', 'failed'],
  clicked: ['completed', 'failed'],
  completed: [],
  failed: [],
};

/**
 * Validate an AdImpression status transition against IMPRESSION_TRANSITIONS.
 * Throws BadRequestException for any transition not enumerated in the table.
 */
export function validateImpressionTransition(from: ImpressionStatus, to: ImpressionStatus): void {
  const allowed = IMPRESSION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid impression transition: ${from} → ${to}. Allowed targets from '${from}': ${allowed?.join(', ') || 'none'}`,
    );
  }
}
