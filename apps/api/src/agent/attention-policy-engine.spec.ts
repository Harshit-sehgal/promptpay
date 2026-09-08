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
  function currentPrediction() {
    return {
      expectedContributionMarginMinor: 300n,
      contributionMarginLowerBoundMinor: 150n,
      advertiserRetentionLowerBoundPpm: 950_000n,
      userRetentionLowerBoundPpm: 950_000n,
      churnUpperBoundPpm: 30_000n,
      sampleSize: 400,
      confidencePpm: 990_000n,
      modelVersion: 'model-current',
    };
  }

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
      currentPrediction(),
    );
    expect(result.status).toBe('retain_current');
    expect(result.recommendedPolicy).toEqual(current);
    expect(result.financialSideEffects).toBe(false);
  });

  it('retains the current policy unless a candidate beats its own margin bound', () => {
    // Admissible candidate whose conservative bound is worse than the current
    // policy's own bound: "best of the candidates" is not an improvement.
    const worseCandidate = {
      policy: { ...current, version: 3, alphaPpm: 480_000n },
      prediction: {
        ...currentPrediction(),
        contributionMarginLowerBoundMinor: 50n,
        sampleSize: 500,
      },
    };
    const result = recommendShadowPolicy(
      current,
      [worseCandidate],
      constraints,
      currentPrediction(),
    );
    expect(result.status).toBe('retain_current');
    expect(result.recommendedPolicy).toEqual(current);
  });

  it('recommends a candidate that beats the current margin bound', () => {
    const betterCandidate = {
      policy: { ...current, version: 4, alphaPpm: 480_000n },
      prediction: {
        ...currentPrediction(),
        contributionMarginLowerBoundMinor: 500n,
        sampleSize: 500,
      },
    };
    const result = recommendShadowPolicy(
      current,
      [betterCandidate],
      constraints,
      currentPrediction(),
    );
    expect(result.status).toBe('recommend');
    expect(result.recommendedPolicy).toEqual(betterCandidate.policy);
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
      {
        // Baseline for the current policy: weaker than both candidates so the
        // winner is decided among the candidates, not against the baseline.
        expectedContributionMarginMinor: 50n,
        contributionMarginLowerBoundMinor: 40n,
        advertiserRetentionLowerBoundPpm: 900_000n,
        userRetentionLowerBoundPpm: 900_000n,
        churnUpperBoundPpm: 60_000n,
        sampleSize: 150,
        confidencePpm: 850_000n,
        modelVersion: 'model-current',
      },
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
      currentPrediction(),
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
      currentPrediction(),
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

  it('never assigns the base version to a grid vector', () => {
    const grid = buildShadowPolicyGrid(current, { alphaPpm: [400_000n, current.alphaPpm] });
    // The base version names the current policy; a different vector carrying
    // it would create two definitions of one immutable version.
    expect(grid.every((policy) => policy.version !== current.version)).toBe(true);
    expect(new Set(grid.map((policy) => policy.version)).size).toBe(grid.length);
    // Distinct grid vectors, both versioned after the base: the base vector
    // participates in dedup but must never carry the base's own version.
    expect(grid).toHaveLength(2);
  });
});
