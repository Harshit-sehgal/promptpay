import type { ShadowSessionFact } from '@ateva/agent-protocol';

import type { ShadowOutcomeRecord } from './attention-shadow-outcomes';

export type ShadowMarketplaceMetrics = {
  sessionCount: number;
  renderedMs: number;
  viewableMs: number;
  aiEligibleMs: number;
  qualifiedMs: number;
  passiveMs: number;
  passiveBillableMs: number;
  qualifiedRatePpm: number;
  viewableRatePpm: number;
  passiveBillableRatePpm: number;
  meanUnknownEventRatePpm: number;
  outcomeCounts: Readonly<Record<string, number>>;
  hypotheticalAdvertiserChargeMinor: bigint | null;
  hypotheticalUserRewardMinor: bigint | null;
  hypotheticalPlatformContributionMinor: bigint | null;
  financialSideEffects: false;
};

/** Reconcile privacy-safe facts and labels into non-financial shadow metrics. */
export function computeShadowMarketplaceMetrics(
  facts: readonly ShadowSessionFact[],
  outcomes: readonly ShadowOutcomeRecord[] = [],
): ShadowMarketplaceMetrics {
  const renderedMs = sum(facts.map((fact) => fact.renderedMs));
  const viewableMs = sum(facts.map((fact) => fact.viewableMs));
  const aiEligibleMs = sum(facts.map((fact) => fact.aiEligibleMs));
  const qualifiedMs = sum(facts.map((fact) => fact.qualifiedMs));
  const passiveMs = sum(facts.map((fact) => fact.passiveMs));
  const passiveBillableMs = sum(facts.map((fact) => fact.passiveBillableMs));
  const charges = sumBigInt(facts.map((fact) => fact.hypotheticalAdvertiserChargeMinor));
  const rewards = sumBigInt(facts.map((fact) => fact.hypotheticalUserRewardMinor));
  const contributions = sumBigInt(facts.map((fact) => fact.hypotheticalPlatformContributionMinor));
  const outcomeCounts: Record<string, number> = {};
  for (const outcome of outcomes) {
    if (Date.parse(outcome.outcomeWindowEnd) <= Date.parse(outcome.outcomeWindowStart)) continue;
    outcomeCounts[outcome.outcomeLabel] = (outcomeCounts[outcome.outcomeLabel] ?? 0) + 1;
  }
  return {
    sessionCount: facts.length,
    renderedMs,
    viewableMs,
    aiEligibleMs,
    qualifiedMs,
    passiveMs,
    passiveBillableMs,
    qualifiedRatePpm: ratioPpm(qualifiedMs, viewableMs),
    viewableRatePpm: ratioPpm(viewableMs, renderedMs),
    passiveBillableRatePpm: ratioPpm(passiveBillableMs, passiveMs),
    meanUnknownEventRatePpm: facts.length
      ? Math.floor(
          Number(facts.reduce((total, fact) => total + fact.unknownEventRatePpm, 0n)) /
            facts.length,
        )
      : 0,
    outcomeCounts,
    hypotheticalAdvertiserChargeMinor: charges,
    hypotheticalUserRewardMinor: rewards,
    hypotheticalPlatformContributionMinor: contributions,
    financialSideEffects: false,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumBigInt(values: readonly (bigint | null)[]): bigint | null {
  if (values.some((value) => value === null) && values.some((value) => value !== null)) return null;
  if (values.every((value) => value === null)) return null;
  return values
    .filter((value): value is bigint => value !== null)
    .reduce((total, value) => total + value, 0n);
}

function ratioPpm(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(1_000_000, Math.floor((numerator * 1_000_000) / denominator));
}
