import {
  evaluateShadowAttention,
  type ShadowAttentionEvaluationInput,
  type ShadowAttentionPolicy,
} from '@ateva/agent-protocol';

export type ShadowPolicyVector = Pick<
  ShadowAttentionPolicy,
  'version' | 'alphaPpm' | 'passiveCapRatioPpm' | 'passiveSessionCapMs' | 'minimumQualifiedMs'
>;

export type CounterfactualPolicyResult = {
  policyVersion: number;
  qualifiedMs: number;
  passiveMs: number;
  passiveBillableMs: number;
  weightedBillablePpmMs: bigint;
  financialSideEffects: false;
};

export type ShadowModelPrediction = {
  expectedContributionMarginMinor: bigint;
  contributionMarginLowerBoundMinor: bigint;
  /** Optional stress bound; when supplied it is the optimizer's margin bound. */
  stressContributionMarginLowerBoundMinor?: bigint;
  advertiserRetentionLowerBoundPpm: bigint;
  userRetentionLowerBoundPpm: bigint;
  churnUpperBoundPpm: bigint;
  advertiserChurnUpperBoundPpm?: bigint;
  userChurnUpperBoundPpm?: bigint;
  fraudRiskUpperBoundPpm?: bigint;
  reserveLowerBoundMinor?: bigint;
  advertiserRoiLowerBoundPpm?: bigint;
  sampleSize: number;
  confidencePpm: bigint;
  modelVersion: string;
};

export type ShadowOptimizerConstraints = {
  minimumAdvertiserRetentionPpm: bigint;
  minimumUserRetentionPpm: bigint;
  maximumChurnPpm: bigint;
  minimumConfidencePpm: bigint;
  minimumSampleSize: number;
  maximumAlphaDeltaPpm: bigint;
  minimumStressMarginMinor?: bigint;
  maximumAdvertiserChurnPpm?: bigint;
  maximumUserChurnPpm?: bigint;
  maximumFraudRiskPpm?: bigint;
  minimumReserveMinor?: bigint;
  minimumAdvertiserRoiPpm?: bigint;
};

export type ShadowRecommendation = {
  status: 'recommend' | 'retain_current' | 'rejected';
  currentPolicy: ShadowPolicyVector;
  recommendedPolicy: ShadowPolicyVector;
  expectedEffects: ShadowModelPrediction | null;
  reason: string;
  financialSideEffects: false;
};

/** Evaluate one observed session under a hypothetical policy only. */
export function evaluateCounterfactualPolicy(
  measurement: ShadowAttentionEvaluationInput,
  policy: ShadowPolicyVector,
): CounterfactualPolicyResult {
  const evaluated = evaluateShadowAttention(measurement, {
    ...policy,
    status: 'shadow',
  });
  const qualifiedMs = evaluated.qualifiedMs;
  return {
    policyVersion: policy.version,
    qualifiedMs,
    passiveMs: qualifiedMs === 0 ? 0 : evaluated.passiveMs,
    passiveBillableMs: qualifiedMs === 0 ? 0 : evaluated.passiveBillableMs,
    weightedBillablePpmMs: qualifiedMs === 0 ? 0n : evaluated.weightedBillablePpmMs,
    financialSideEffects: false,
  };
}

/**
 * Choose among already-produced model predictions. This function is
 * deliberately pure and has no activation callback or financial dependency.
 * Unknown/under-powered predictions retain the current policy.
 */
export function recommendShadowPolicy(
  currentPolicy: ShadowPolicyVector,
  candidates: readonly { policy: ShadowPolicyVector; prediction: ShadowModelPrediction }[],
  constraints: ShadowOptimizerConstraints,
): ShadowRecommendation {
  const admissible = candidates.filter(({ policy, prediction }) => {
    const alphaDelta =
      policy.alphaPpm > currentPolicy.alphaPpm
        ? policy.alphaPpm - currentPolicy.alphaPpm
        : currentPolicy.alphaPpm - policy.alphaPpm;
    const marginBound =
      prediction.stressContributionMarginLowerBoundMinor ??
      prediction.contributionMarginLowerBoundMinor;
    return (
      prediction.sampleSize >= constraints.minimumSampleSize &&
      prediction.confidencePpm >= constraints.minimumConfidencePpm &&
      marginBound >= 0n &&
      prediction.advertiserRetentionLowerBoundPpm >= constraints.minimumAdvertiserRetentionPpm &&
      prediction.userRetentionLowerBoundPpm >= constraints.minimumUserRetentionPpm &&
      prediction.churnUpperBoundPpm <= constraints.maximumChurnPpm &&
      alphaDelta <= constraints.maximumAlphaDeltaPpm &&
      satisfiesOptionalGuardrails(prediction, constraints)
    );
  });

  if (admissible.length === 0) {
    return {
      status: 'retain_current',
      currentPolicy,
      recommendedPolicy: currentPolicy,
      expectedEffects: null,
      reason:
        'No candidate satisfies the approved confidence, sample, margin, retention, churn, and movement guardrails.',
      financialSideEffects: false,
    };
  }

  const best = admissible.reduce((winner, candidate) =>
    marginBound(candidate.prediction) > marginBound(winner.prediction) ? candidate : winner,
  );

  if (best.policy.version === currentPolicy.version) {
    return {
      status: 'retain_current',
      currentPolicy,
      recommendedPolicy: currentPolicy,
      expectedEffects: best.prediction,
      reason: 'The current policy has the strongest approved lower-bound contribution margin.',
      financialSideEffects: false,
    };
  }

  return {
    status: 'recommend',
    currentPolicy,
    recommendedPolicy: best.policy,
    expectedEffects: best.prediction,
    reason:
      'Candidate improves the conservative contribution-margin bound while satisfying every approved guardrail; human approval remains required.',
    financialSideEffects: false,
  };
}

/**
 * Produce a finite counterfactual grid. Each vector is still a shadow policy
 * and receives a distinct version; this helper has no activation or money
 * callback and deliberately has no reward-rate dimension.
 */
export function buildShadowPolicyGrid(
  base: ShadowPolicyVector,
  options: {
    alphaPpm?: readonly bigint[];
    passiveCapRatioPpm?: readonly bigint[];
    passiveSessionCapMs?: readonly number[];
    minimumQualifiedMs?: readonly number[];
  } = {},
): ShadowPolicyVector[] {
  const alphas = options.alphaPpm ?? [base.alphaPpm];
  const ratios = options.passiveCapRatioPpm ?? [base.passiveCapRatioPpm];
  const caps = options.passiveSessionCapMs ?? [base.passiveSessionCapMs];
  const minimums = options.minimumQualifiedMs ?? [base.minimumQualifiedMs];
  const vectors: ShadowPolicyVector[] = [];
  let version = base.version;
  for (const alphaPpm of alphas) {
    for (const passiveCapRatioPpm of ratios) {
      for (const passiveSessionCapMs of caps) {
        for (const minimumQualifiedMs of minimums) {
          const candidate = {
            ...base,
            version: version++,
            alphaPpm,
            passiveCapRatioPpm,
            passiveSessionCapMs,
            minimumQualifiedMs,
          };
          if (!vectors.some((existing) => samePolicy(existing, candidate))) vectors.push(candidate);
        }
      }
    }
  }
  return vectors;
}

function marginBound(prediction: ShadowModelPrediction): bigint {
  return (
    prediction.stressContributionMarginLowerBoundMinor ??
    prediction.contributionMarginLowerBoundMinor
  );
}

function satisfiesOptionalGuardrails(
  prediction: ShadowModelPrediction,
  constraints: ShadowOptimizerConstraints,
): boolean {
  if (
    constraints.minimumStressMarginMinor !== undefined &&
    (prediction.stressContributionMarginLowerBoundMinor === undefined ||
      prediction.stressContributionMarginLowerBoundMinor < constraints.minimumStressMarginMinor)
  ) {
    return false;
  }
  if (
    constraints.maximumAdvertiserChurnPpm !== undefined &&
    (prediction.advertiserChurnUpperBoundPpm === undefined ||
      prediction.advertiserChurnUpperBoundPpm > constraints.maximumAdvertiserChurnPpm)
  ) {
    return false;
  }
  if (
    constraints.maximumUserChurnPpm !== undefined &&
    (prediction.userChurnUpperBoundPpm === undefined ||
      prediction.userChurnUpperBoundPpm > constraints.maximumUserChurnPpm)
  ) {
    return false;
  }
  if (
    constraints.maximumFraudRiskPpm !== undefined &&
    (prediction.fraudRiskUpperBoundPpm === undefined ||
      prediction.fraudRiskUpperBoundPpm > constraints.maximumFraudRiskPpm)
  ) {
    return false;
  }
  if (
    constraints.minimumReserveMinor !== undefined &&
    (prediction.reserveLowerBoundMinor === undefined ||
      prediction.reserveLowerBoundMinor < constraints.minimumReserveMinor)
  ) {
    return false;
  }
  if (
    constraints.minimumAdvertiserRoiPpm !== undefined &&
    (prediction.advertiserRoiLowerBoundPpm === undefined ||
      prediction.advertiserRoiLowerBoundPpm < constraints.minimumAdvertiserRoiPpm)
  ) {
    return false;
  }
  return true;
}

function samePolicy(left: ShadowPolicyVector, right: ShadowPolicyVector): boolean {
  return (
    left.alphaPpm === right.alphaPpm &&
    left.passiveCapRatioPpm === right.passiveCapRatioPpm &&
    left.passiveSessionCapMs === right.passiveSessionCapMs &&
    left.minimumQualifiedMs === right.minimumQualifiedMs
  );
}
