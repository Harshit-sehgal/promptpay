import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import {
  validateWebhookTransition,
  WEBHOOK_TRANSITIONS,
  WebhookProcessingStatus,
} from './payout-webhook-state-machine';

describe('payout-webhook-state-machine', () => {
  const valid: Array<[WebhookProcessingStatus, WebhookProcessingStatus]> = [
    ['pending', 'processing'],
    ['pending', 'pending_review'],
    ['pending', 'dead_letter'],
    ['processing', 'pending'],
    ['processing', 'pending_review'],
    ['processing', 'dead_letter'],
    ['pending_review', 'processing'],
    ['pending_review', 'dead_letter'],
    ['dead_letter', 'processing'],
  ];

  it.each(valid)('allows %s → %s', (from, to) => {
    expect(() => validateWebhookTransition(from, to)).not.toThrow();
  });

  const invalid: Array<[WebhookProcessingStatus, WebhookProcessingStatus]> = [
    ['pending', 'pending'],
    ['pending', 'dead_letter_pending' as WebhookProcessingStatus],
    ['processing', 'processing'],
    ['pending_review', 'pending'],
    ['pending_review', 'pending_review'],
    ['dead_letter', 'pending'],
    ['dead_letter', 'pending_review'],
    ['dead_letter', 'dead_letter'],
  ];

  it.each(invalid)('rejects %s → %s', (from, to) => {
    expect(() => validateWebhookTransition(from, to)).toThrow(BadRequestException);
  });

  it('enumerates every status as a key', () => {
    const keys = Object.keys(WEBHOOK_TRANSITIONS).sort();
    expect(keys).toEqual(['dead_letter', 'pending', 'pending_review', 'processing']);
  });
});
