import { describe, expect, it } from 'vitest';

import {
  buildShadowPolicyGrid,
  evaluateCounterfactualPolicy,
  recommendShadowPolicy,
  type ShadowPolicyVector,
} from './attention-policy-engine';

const current: ShadowPolicyVector = {
  version: 1,
  alphaPpm: 450_000n,
  passiveCapRatioPpm: 500_000n,
  passiveSessionCapMs: 60_000,
  minimumQualifiedMs: 1_000,
};

const constraints = {
  minimumAdvertiserRetentionPpm: 800_000n,
  minimumUserRetentionPpm: 800_000n,
  maximumChurnPpm: 100_000n,
  minimumConfidencePpm: 800_000n,
  minimumSampleSize: 100,
  maximumAlphaDeltaPpm: 50_000n,
};

describe('attention policy engine', () => {
  it('evaluates hypothetical economics without financial side effects', () => {
    const result = evaluateCounterfactualPolicy(
      { renderedMs: 20_000, viewableMs: 10_000, aiEligibleMs: 5_000 },
      current,
    );
    expect(result.qualifiedMs).toBe(5_000);
    expect(result.financialSideEffects).toBe(false);
  });

  it('zeroes passive inventory when minimum qualification is not met', () => {
    const result = evaluateCounterfactualPolicy(
      { renderedMs: 20_000, viewableMs: 10_000, aiEligibleMs: 500 },
      { ...current, minimumQualifiedMs: 1_000 },
    );
    expect(result.qualifiedMs).toBe(0);
    expect(result.passiveBillableMs).toBe(0);
  });

  it('retains current policy when candidates lack evidence', () => {
    const result = recommendShadowPolicy(
      current,
      [
        {
          policy: { ...current, version: 2, alphaPpm: 500_000n },
          prediction: {
            expectedContributionMarginMinor: 200n,
            contributionMarginLowerBoundMinor: 100n,
            advertiserRetentionLowerBoundPpm: 900_000n,
            userRetentionLowerBoundPpm: 900_000n,
            churnUpperBoundPpm: 50_000n,
            sampleSize: 99,
            confidencePpm: 950_000n,
            modelVersion: 'model-1',
          },
        },
      ],
      constraints,
    );
    expect(result.status).toBe('retain_current');
    expect(result.recommendedPolicy).toEqual(current);
    expect(result.financialSideEffects).toBe(false);
  });

  it('selects the strongest admissible lower-bound candidate', () => {
    const result = recommendShadowPolicy(
      current,
      [
        {
          policy: { ...current, version: 2, alphaPpm: 480_000n },
          prediction: {
            expectedContributionMarginMinor: 140n,
            contributionMarginLowerBoundMinor: 100n,
            advertiserRetentionLowerBoundPpm: 850_000n,
            userRetentionLowerBoundPpm: 850_000n,
            churnUpperBoundPpm: 80_000n,
            sampleSize: 200,
            confidencePpm: 900_000n,
            modelVersion: 'model-1',
          },
        },
        {
          policy: { ...current, version: 3, alphaPpm: 490_000n },
          prediction: {
            expectedContributionMarginMinor: 180n,
            contributionMarginLowerBoundMinor: 120n,
            advertiserRetentionLowerBoundPpm: 850_000n,
            userRetentionLowerBoundPpm: 850_000n,
            churnUpperBoundPpm: 80_000n,
            sampleSize: 200,
            confidencePpm: 900_000n,
            modelVersion: 'model-1',
          },
        },
      ],
      constraints,
    );
    expect(result.status).toBe('recommend');
    expect(result.recommendedPolicy.version).toBe(3);
  });

  it('rejects candidates outside movement and retention guardrails', () => {
    const result = recommendShadowPolicy(
      current,
      [
        {
          policy: { ...current, version: 2, alphaPpm: 700_000n },
          prediction: {
            expectedContributionMarginMinor: 1_000n,
            contributionMarginLowerBoundMinor: 900n,
            advertiserRetentionLowerBoundPpm: 700_000n,
            userRetentionLowerBoundPpm: 900_000n,
            churnUpperBoundPpm: 20_000n,
            sampleSize: 10_000,
            confidencePpm: 999_000n,
            modelVersion: 'model-1',
          },
        },
      ],
      constraints,
    );
    expect(result.status).toBe('retain_current');
  });

  it('requires optional hard guardrails to have corresponding model bounds', () => {
    const result = recommendShadowPolicy(
      current,
      [
        {
          policy: { ...current, version: 2, alphaPpm: 480_000n },
          prediction: {
            expectedContributionMarginMinor: 200n,
            contributionMarginLowerBoundMinor: 150n,
            advertiserRetentionLowerBoundPpm: 900_000n,
            userRetentionLowerBoundPpm: 900_000n,
            churnUpperBoundPpm: 50_000n,
            sampleSize: 200,
            confidencePpm: 900_000n,
            modelVersion: 'model-1',
          },
        },
      ],
      { ...constraints, minimumStressMarginMinor: 100n },
    );
    expect(result.status).toBe('retain_current');
  });

  it('builds a bounded counterfactual grid without a reward-rate dimension', () => {
    const grid = buildShadowPolicyGrid(current, {
      alphaPpm: [400_000n, 500_000n],
      passiveCapRatioPpm: [500_000n, 1_000_000n],
      passiveSessionCapMs: [30_000, 60_000],
      minimumQualifiedMs: [1_000, 2_000],
    });
    expect(grid).toHaveLength(16);
    expect(new Set(grid.map((policy) => policy.version)).size).toBe(16);
    expect(grid.every((policy) => !('rewardMultiplierPpm' in policy))).toBe(true);
  });
});
