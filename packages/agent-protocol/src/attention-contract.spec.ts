import { describe, expect, it } from 'vitest';

import {
  assignShadowPolicyToSession,
  ATTENTION_PPM_SCALE,
  evaluateShadowAttention,
  shadowAttentionPolicySchema,
  shadowPolicyRecordSchema,
} from './attention-contract';

describe('shadow attention contract', () => {
  const policy = {
    version: 1,
    status: 'shadow' as const,
    alphaPpm: 500_000n,
    passiveCapRatioPpm: 1_000_000n,
    passiveSessionCapMs: 60_000,
    minimumQualifiedMs: 1_000,
  };

  it('validates an additive shadow policy record without financial fields', () => {
    const record = shadowPolicyRecordSchema.parse({
      id: 'policy-1',
      version: 1,
      status: 'shadow',
      alphaPpm: 500_000n,
      passiveCapRatioPpm: 1_000_000n,
      passiveSessionCapMs: 60_000,
      minimumQualifiedMs: 1_000,
      effectiveAt: '2026-08-30T00:00:00.000Z',
      retiredAt: null,
      parentPolicyId: null,
      modelVersion: 'model-1',
      experimentId: null,
      policyDigest: 'a'.repeat(64),
    });
    expect(record.version).toBe(1);
    expect(() =>
      shadowPolicyRecordSchema.parse({ ...record, advertiserChargeMinor: 1n }),
    ).toThrow();
  });

  it('assigns one immutable policy version to a session', () => {
    expect(assignShadowPolicyToSession('session-1', policy, '2026-08-30T00:00:00.000Z')).toEqual({
      sessionId: 'session-1',
      policyVersion: 1,
      assignedAt: '2026-08-30T00:00:00.000Z',
    });
    expect(() =>
      assignShadowPolicyToSession(
        'session-1',
        { ...policy, status: 'retired' },
        '2026-08-30T00:00:00.000Z',
      ),
    ).toThrow();
  });

  it('computes qualified, passive, capped, and weighted time deterministically', () => {
    expect(
      evaluateShadowAttention(
        { renderedMs: 20_000, viewableMs: 15_000, aiEligibleMs: 10_000 },
        policy,
      ),
    ).toEqual({
      renderedMs: 20_000,
      viewableMs: 15_000,
      aiEligibleMs: 10_000,
      qualifiedMs: 10_000,
      passiveMs: 5_000,
      passiveBillableMs: 5_000,
      weightedBillablePpmMs: 12_500_000_000n,
    });
  });

  it('prevents passive exposure from becoming billable when Q is zero', () => {
    const result = evaluateShadowAttention(
      { renderedMs: 30_000, viewableMs: 30_000, aiEligibleMs: 0 },
      policy,
    );
    expect(result.qualifiedMs).toBe(0);
    expect(result.passiveMs).toBe(30_000);
    expect(result.passiveBillableMs).toBe(0);
    expect(result.weightedBillablePpmMs).toBe(0n);
  });

  it('applies both the qualified-ratio and absolute passive caps', () => {
    const result = evaluateShadowAttention(
      { renderedMs: 120_000, viewableMs: 100_000, aiEligibleMs: 40_000 },
      { ...policy, passiveCapRatioPpm: 250_000n, passiveSessionCapMs: 20_000 },
    );
    expect(result.passiveMs).toBe(60_000);
    expect(result.passiveBillableMs).toBe(10_000);
  });

  it('rejects viewable time greater than rendered time', () => {
    expect(() =>
      evaluateShadowAttention(
        { renderedMs: 1_000, viewableMs: 1_001, aiEligibleMs: 1_000 },
        policy,
      ),
    ).toThrow('viewableMs cannot exceed renderedMs');
  });

  it('bounds alpha and passive ratio using fixed-point integers', () => {
    expect(
      shadowAttentionPolicySchema.parse({
        ...policy,
        alphaPpm: ATTENTION_PPM_SCALE,
        passiveCapRatioPpm: ATTENTION_PPM_SCALE,
      }),
    ).toEqual({
      ...policy,
      alphaPpm: ATTENTION_PPM_SCALE,
      passiveCapRatioPpm: ATTENTION_PPM_SCALE,
    });
    expect(() =>
      shadowAttentionPolicySchema.parse({ ...policy, alphaPpm: ATTENTION_PPM_SCALE + 1n }),
    ).toThrow();
    expect(() =>
      shadowAttentionPolicySchema.parse({
        ...policy,
        passiveCapRatioPpm: ATTENTION_PPM_SCALE + 1n,
      }),
    ).toThrow();
  });
});
