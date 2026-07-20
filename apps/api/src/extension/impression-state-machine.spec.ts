import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import {
  IMPRESSION_TRANSITIONS,
  ImpressionStatus,
  validateImpressionTransition,
} from './impression-state-machine';

describe('impression-state-machine', () => {
  const valid: Array<[ImpressionStatus, ImpressionStatus]> = [
    ['served', 'viewed'],
    ['served', 'clicked'],
    ['served', 'failed'],
    ['viewed', 'clicked'],
    ['viewed', 'completed'],
    ['viewed', 'failed'],
    ['clicked', 'completed'],
    ['clicked', 'failed'],
  ];

  it.each(valid)('allows %s → %s', (from, to) => {
    expect(() => validateImpressionTransition(from, to)).not.toThrow();
  });

  const invalid: Array<[ImpressionStatus, ImpressionStatus]> = [
    ['served', 'completed'],
    ['served', 'served'],
    ['viewed', 'viewed'],
    ['viewed', 'served'],
    ['clicked', 'clicked'],
    ['clicked', 'viewed'],
    ['clicked', 'served'],
    ['completed', 'served'],
    ['completed', 'viewed'],
    ['completed', 'clicked'],
    ['completed', 'failed'],
    ['failed', 'served'],
    ['failed', 'viewed'],
    ['failed', 'clicked'],
    ['failed', 'completed'],
    ['failed', 'failed'],
  ];

  it.each(invalid)('rejects %s → %s', (from, to) => {
    expect(() => validateImpressionTransition(from, to)).toThrow(BadRequestException);
  });

  it('enumerates every status as a key', () => {
    const keys = Object.keys(IMPRESSION_TRANSITIONS).sort();
    expect(keys).toEqual(['clicked', 'completed', 'failed', 'served', 'viewed']);
  });
});
