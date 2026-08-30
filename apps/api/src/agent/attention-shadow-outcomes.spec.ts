import { describe, expect, it } from 'vitest';

import { createShadowOutcomeRecord } from './attention-shadow-outcomes';

describe('shadow outcome records', () => {
  const base = {
    sessionKey: 'a'.repeat(64),
    outcomeLabel: 'user_returned' as const,
    outcomeWindowStart: '2026-08-30T00:00:00.000Z',
    outcomeWindowEnd: '2026-08-31T00:00:00.000Z',
    observedAt: '2026-08-30T01:00:00.000Z',
    experimentId: 'experiment-1',
    experimentVariant: 'control',
    policyVersion: 1,
  };

  it('creates a versioned privacy-minimized outcome record', () => {
    expect(createShadowOutcomeRecord(base)).toMatchObject({
      datasetVersion: 1,
      outcomeLabel: 'user_returned',
      policyVersion: 1,
    });
  });

  it('rejects reversed outcome windows and unknown sensitive fields', () => {
    expect(() =>
      createShadowOutcomeRecord({
        ...base,
        outcomeWindowEnd: base.outcomeWindowStart,
      }),
    ).toThrow();
    expect(() =>
      createShadowOutcomeRecord({ ...base, prompt: 'private content' } as never),
    ).toThrow();
  });
});
