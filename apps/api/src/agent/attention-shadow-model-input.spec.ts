import { describe, expect, it } from 'vitest';

import { createShadowFeatureRecord } from './attention-shadow-feature';
import { createShadowModelInput } from './attention-shadow-model-input';
import { createShadowOutcomeRecord } from './attention-shadow-outcomes';

describe('shadow model input', () => {
  const feature = createShadowFeatureRecord({
    sessionKey: 'a'.repeat(64),
    environmentKind: 'sandbox',
    policyVersion: 1,
    experimentVariant: 'control',
    providerClass: 'claude_code',
    integrationMode: 'native_hook',
    renderedMs: 1_000,
    viewableMs: 1_000,
    aiEligibleMs: 1_000,
    qualifiedMs: 1_000,
    passiveMs: 0,
    passiveBillableMs: 0,
    weightedBillablePpmMs: 1_000_000_000n,
  });

  it('joins a matching outcome to a feature row', () => {
    const outcome = createShadowOutcomeRecord({
      sessionKey: feature.sessionKey,
      outcomeLabel: 'none_observed',
      outcomeWindowStart: '2026-08-30T00:00:00.000Z',
      outcomeWindowEnd: '2026-08-31T00:00:00.000Z',
      observedAt: '2026-08-30T01:00:00.000Z',
      experimentId: null,
      experimentVariant: 'control',
      policyVersion: 1,
    });
    expect(createShadowModelInput(feature, outcome).datasetVersion).toBe(1);
  });

  it('rejects mismatched session and policy identity', () => {
    const outcome = createShadowOutcomeRecord({
      sessionKey: 'b'.repeat(64),
      outcomeLabel: 'clicked',
      outcomeWindowStart: '2026-08-30T00:00:00.000Z',
      outcomeWindowEnd: '2026-08-31T00:00:00.000Z',
      observedAt: '2026-08-30T01:00:00.000Z',
      experimentId: null,
      experimentVariant: null,
      policyVersion: 2,
    });
    expect(() => createShadowModelInput(feature, outcome)).toThrow();
  });
});
