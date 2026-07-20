import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import {
  CAMPAIGN_TRANSITIONS,
  CampaignStatus,
  validateCampaignTransition,
} from './campaign-state-machine';

describe('campaign-state-machine', () => {
  const valid: Array<[CampaignStatus, CampaignStatus]> = [
    ['draft', 'submitted'],
    ['draft', 'archived'],
    ['submitted', 'under_review'],
    ['submitted', 'draft'],
    ['under_review', 'approved'],
    ['under_review', 'rejected'],
    ['under_review', 'draft'],
    ['approved', 'active'],
    ['approved', 'archived'],
    ['active', 'paused'],
    ['active', 'archived'],
    ['paused', 'active'],
    ['paused', 'archived'],
    ['rejected', 'draft'],
  ];

  it.each(valid)('allows %s → %s', (from, to) => {
    expect(() => validateCampaignTransition(from, to)).not.toThrow();
  });

  const invalid: Array<[CampaignStatus, CampaignStatus]> = [
    ['draft', 'approved'],
    ['draft', 'active'],
    ['draft', 'paused'],
    ['draft', 'rejected'],
    ['draft', 'under_review'],
    ['submitted', 'approved'],
    ['submitted', 'rejected'],
    ['submitted', 'active'],
    ['submitted', 'paused'],
    ['submitted', 'archived'],
    ['under_review', 'submitted'],
    ['under_review', 'active'],
    ['under_review', 'paused'],
    ['under_review', 'archived'],
    ['approved', 'submitted'],
    ['approved', 'under_review'],
    ['approved', 'rejected'],
    ['approved', 'paused'],
    ['approved', 'draft'],
    ['active', 'submitted'],
    ['active', 'under_review'],
    ['active', 'approved'],
    ['active', 'rejected'],
    ['active', 'draft'],
    ['paused', 'submitted'],
    ['paused', 'under_review'],
    ['paused', 'approved'],
    ['paused', 'rejected'],
    ['paused', 'draft'],
    ['rejected', 'submitted'],
    ['rejected', 'under_review'],
    ['rejected', 'approved'],
    ['rejected', 'active'],
    ['rejected', 'paused'],
    ['rejected', 'archived'],
    ['archived', 'draft'],
    ['archived', 'submitted'],
    ['archived', 'under_review'],
    ['archived', 'approved'],
    ['archived', 'rejected'],
    ['archived', 'active'],
    ['archived', 'paused'],
  ];

  it.each(invalid)('rejects %s → %s', (from, to) => {
    expect(() => validateCampaignTransition(from, to)).toThrow(BadRequestException);
  });

  it('enumerates every status as a key', () => {
    const keys = Object.keys(CAMPAIGN_TRANSITIONS).sort();
    expect(keys).toEqual(
      [
        'active',
        'approved',
        'archived',
        'draft',
        'paused',
        'rejected',
        'submitted',
        'under_review',
      ].sort(),
    );
  });
});
