import { BadRequestException } from '@nestjs/common';

/**
 * Declarative AdCreative lifecycle (P2.2 — unified state machine).
 *
 *   draft ─▶ pending_review ─┬─▶ approved (terminal for serving)
 *                             └─▶ rejected
 *   approved / rejected ─▶ draft   (re-edit resets to draft for re-review)
 *
 * `pending_review` is the only state from which a reviewer may approve or
 * reject. `updateCreative` resets any non-terminal creative to `draft` for
 * re-review. `submitCampaign` moves a draft creative to `pending_review`.
 *
 * NOTE: `approveCreative` / `rejectCreative` are intentionally idempotent at
 * the call site (they re-assert the same status without a `from`-guard), so
 * this machine documents the *intended* lifecycle and is the canonical
 * reference for new call sites. Tightening the call sites to enforce
 * `validateCreativeTransition` is a deliberate follow-up that must not break
 * the idempotent re-approve path the e2e suite relies on.
 */
export type CreativeStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export const CREATIVE_TRANSITIONS: Record<CreativeStatus, CreativeStatus[]> = {
  draft: ['pending_review', 'approved', 'draft'],
  pending_review: ['approved', 'rejected', 'draft'],
  approved: ['draft'],
  rejected: ['draft'],
};

/**
 * Validate an AdCreative status transition against CREATIVE_TRANSITIONS.
 * Throws BadRequestException for any transition not enumerated in the table.
 */
export function validateCreativeTransition(from: CreativeStatus, to: CreativeStatus): void {
  const allowed = CREATIVE_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid creative transition: ${from} → ${to}. Allowed targets from '${from}': ${allowed?.join(', ') || 'none'}`,
    );
  }
}
