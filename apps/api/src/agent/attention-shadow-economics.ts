import {
  evaluateShadowAttention,
  ShadowAttentionMeasurement,
  ShadowAttentionPolicy,
} from '@ateva/agent-protocol';

export type ShadowEconomics = ShadowAttentionMeasurement & {
  policyVersion: number;
};

export type ShadowPolicyComparison = {
  currentPolicyVersion: number;
  candidates: ShadowEconomics[];
  financialSideEffects: false;
};

export function evaluateShadowEconomics(
  measurement: Pick<ShadowAttentionMeasurement, 'renderedMs' | 'viewableMs' | 'aiEligibleMs'>,
  policy: ShadowAttentionPolicy,
): ShadowEconomics {
  return {
    ...evaluateShadowAttention(measurement, policy),
    policyVersion: policy.version,
  };
}

export function compareShadowPolicies(
  measurement: Pick<ShadowAttentionMeasurement, 'renderedMs' | 'viewableMs' | 'aiEligibleMs'>,
  currentPolicy: ShadowAttentionPolicy,
  candidates: readonly ShadowAttentionPolicy[],
): ShadowPolicyComparison {
  return {
    currentPolicyVersion: currentPolicy.version,
    candidates: [currentPolicy, ...candidates].map((policy) =>
      evaluateShadowEconomics(measurement, policy),
    ),
    financialSideEffects: false,
  };
}
