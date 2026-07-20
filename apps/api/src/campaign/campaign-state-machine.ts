import { BadRequestException } from '@nestjs/common';

/**
 * Declarative Campaign lifecycle (P2.2 — unified state machine).
 *
 *   draft ─▶ submitted ─▶ under_review ─┬─▶ approved ─▶ active ⇄ paused
 *                  │                     ├─▶ rejected ─▶ draft            │
 *                  │                     └─▶ draft                        │
 *                  └─▶ archived                                          │
 *   approved ─▶ archived                                                 │
 *   active ─▶ archived ──────────────────────────────────────────────────┘
 *   paused ─▶ archived
 *
 * `archived` is terminal. `rejected` can only return to `draft` (the
 * draft → submit → reject → resubmit recovery loop). `submitted` advances to
 * `under_review` or may be pulled back to `draft`. `paused`/`active` are the
 * only live serving states and may each be archived.
 */
export type CampaignStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'paused'
  | 'archived';

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['submitted', 'archived'],
  submitted: ['under_review', 'draft'],
  under_review: ['approved', 'rejected', 'draft'],
  approved: ['active', 'archived'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  rejected: ['draft'],
  archived: [],
};

/**
 * Validate a Campaign status transition against CAMPAIGN_TRANSITIONS.
 * Throws BadRequestException for any transition not enumerated in the table
 * (including resolving a terminal `archived` campaign). Callers remain
 * responsible for the atomic CAS `updateMany where status = (…)` guard; this
 * is the declarative, human-readable pre-check layered in front of it.
 */
export function validateCampaignTransition(from: CampaignStatus, to: CampaignStatus): void {
  const allowed = CAMPAIGN_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid campaign transition: ${from} → ${to}. Allowed targets from '${from}': ${allowed?.join(', ') || 'none'}`,
    );
  }
}
