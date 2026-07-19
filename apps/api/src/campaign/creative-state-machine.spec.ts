import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import {
  CREATIVE_TRANSITIONS,
  CreativeStatus,
  validateCreativeTransition,
} from './creative-state-machine';

describe('creative-state-machine', () => {
  const valid: Array<[CreativeStatus, CreativeStatus]> = [
    ['draft', 'pending_review'],
    ['draft', 'draft'],
    ['pending_review', 'approved'],
    ['pending_review', 'rejected'],
    ['pending_review', 'draft'],
    ['approved', 'draft'],
    ['rejected', 'draft'],
  ];

  it.each(valid)('allows %s → %s', (from, to) => {
    expect(() => validateCreativeTransition(from, to)).not.toThrow();
  });

  const invalid: Array<[CreativeStatus, CreativeStatus]> = [
    ['draft', 'approved'],
    ['draft', 'rejected'],
    ['pending_review', 'pending_review'],
    ['approved', 'approved'],
    ['approved', 'rejected'],
    ['approved', 'pending_review'],
    ['rejected', 'approved'],
    ['rejected', 'rejected'],
    ['rejected', 'pending_review'],
  ];

  it.each(invalid)('rejects %s → %s', (from, to) => {
    expect(() => validateCreativeTransition(from, to)).toThrow(BadRequestException);
  });

  it('enumerates every status as a key', () => {
    const keys = Object.keys(CREATIVE_TRANSITIONS).sort();
    expect(keys).toEqual(['approved', 'draft', 'pending_review', 'rejected']);
  });
});
