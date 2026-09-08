import { describe, expect, it } from 'vitest';

import { createShadowFeatureRecord, SHADOW_FEATURE_NAMES } from './attention-shadow-feature';

describe('shadow attention feature records', () => {
  const base = {
    sessionKey: 'a'.repeat(64),
    environmentKind: 'sandbox' as const,
    policyVersion: 1,
    experimentVariant: 'control',
    providerClass: 'claude_code',
    integrationMode: 'native_hook',
    renderedMs: 20_000,
    viewableMs: 15_000,
    aiEligibleMs: 10_000,
    qualifiedMs: 10_000,
    passiveMs: 5_000,
    passiveBillableMs: 5_000,
    weightedBillablePpmMs: 12_500_000_000n,
  };

  it('creates a versioned, privacy-minimized feature record', () => {
    const record = createShadowFeatureRecord(base);
    expect(record.datasetVersion).toBe(1);
    expect(record.weightedBillablePpmMs).toBe(12_500_000_000n);
    expect(SHADOW_FEATURE_NAMES).not.toContain('prompt' as never);
    expect(SHADOW_FEATURE_NAMES).not.toContain('source_code' as never);
    expect(JSON.stringify(record)).not.toContain('ledger');
  });

  it('rejects violated duration and passive-exposure invariants', () => {
    expect(() => createShadowFeatureRecord({ ...base, qualifiedMs: 15_001 })).toThrow();
    expect(() => createShadowFeatureRecord({ ...base, viewableMs: 20_001 })).toThrow();
    expect(() => createShadowFeatureRecord({ ...base, passiveBillableMs: 5_001 })).toThrow();
  });

  it('rejects raw sensitive fields instead of silently retaining them', () => {
    expect(() =>
      createShadowFeatureRecord({ ...base, prompt: 'private content' } as never),
    ).toThrow();
  });
});
