import { BadRequestException } from '@nestjs/common';

/**
 * Declarative Stripe webhook-event processing lifecycle (P2.2).
 *
 *   pending ─┬─▶ processing ─┬─▶ pending       (retry / reclaim)
 *            │               ├─▶ pending_review (manual review)
 *            │               └─▶ dead_letter   (poisoned, needs ops)
 *            ├─▶ pending_review
 *            └─▶ dead_letter
 *   pending_review ─┬─▶ processing
 *                   └─▶ dead_letter
 *   dead_letter ─▶ processing   (reprocess after triage)
 *
 * `processing` is the in-flight state; `pending` is the newly-received or
 * reclaimed state; `pending_review` parks an event for a human; `dead_letter`
 * is terminal-until-triaged. The controller additionally writes a `processed`
 * terminal marker on success, which is intentionally OUTSIDE this sub-state
 * machine (a delivery receipt, not a processing state).
 */
export type WebhookProcessingStatus = 'pending' | 'processing' | 'pending_review' | 'dead_letter';

export const WEBHOOK_TRANSITIONS: Record<WebhookProcessingStatus, WebhookProcessingStatus[]> = {
  pending: ['processing', 'pending_review', 'dead_letter'],
  processing: ['pending', 'pending_review', 'dead_letter'],
  pending_review: ['processing', 'dead_letter'],
  dead_letter: ['processing'],
};

/**
 * Validate a webhook processing-status transition against WEBHOOK_TRANSITIONS.
 * Throws BadRequestException for any transition not enumerated in the table.
 */
export function validateWebhookTransition(
  from: WebhookProcessingStatus,
  to: WebhookProcessingStatus,
): void {
  const allowed = WEBHOOK_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid webhook transition: ${from} → ${to}. Allowed targets from '${from}': ${allowed?.join(', ') || 'none'}`,
    );
  }
}
