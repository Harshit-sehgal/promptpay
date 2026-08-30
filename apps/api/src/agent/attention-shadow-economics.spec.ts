import { describe, expect, it } from 'vitest';

import { compareShadowPolicies, evaluateShadowEconomics } from './attention-shadow-economics';

describe('shadow attention economics', () => {
  const current = {
    version: 1,
    status: 'shadow' as const,
    alphaPpm: 500_000n,
    passiveCapRatioPpm: 1_000_000n,
    passiveSessionCapMs: 60_000,
  };

  it('evaluates economics without producing financial amounts', () => {
    const result = evaluateShadowEconomics(
      { renderedMs: 20_000, viewableMs: 15_000, aiEligibleMs: 10_000 },
      current,
    );
    expect(result).toMatchObject({
      policyVersion: 1,
      qualifiedMs: 10_000,
      passiveMs: 5_000,
      passiveBillableMs: 5_000,
    });
    expect(result).not.toHaveProperty('advertiserChargeMinor');
    expect(result).not.toHaveProperty('userRewardMinor');
  });

  it('compares bootstrap candidates while retaining the current policy', () => {
    const result = compareShadowPolicies(
      { renderedMs: 20_000, viewableMs: 15_000, aiEligibleMs: 10_000 },
      current,
      [
        { ...current, version: 2, alphaPpm: 250_000n },
        { ...current, version: 3, alphaPpm: 750_000n },
      ],
    );
    expect(result.currentPolicyVersion).toBe(1);
    expect(result.candidates.map((candidate) => candidate.policyVersion)).toEqual([1, 2, 3]);
    expect(result.candidates.map((candidate) => candidate.weightedBillablePpmMs)).toEqual([
      12_500_000_000n,
      11_250_000_000n,
      13_750_000_000n,
    ]);
    expect(result.financialSideEffects).toBe(false);
  });
});
