import { describe, expect, it } from 'vitest';

import { computeShadowMarketplaceMetrics } from './attention-shadow-metrics';

const fact = {
  datasetVersion: 1 as const,
  sessionKey: 'a'.repeat(64),
  userKey: 'b'.repeat(64),
  deviceKey: 'c'.repeat(64),
  observedAt: '2026-08-31T00:00:00.000Z',
  sessionStartedAt: '2026-08-31T00:00:00.000Z',
  sessionEndedAt: '2026-08-31T00:01:00.000Z',
  environmentKind: 'sandbox' as const,
  environmentId: 'sandbox-1',
  providerClass: 'claude_code',
  integrationMode: 'native_hook',
  toolClass: null,
  policyVersion: 1,
  alphaPpm: 500_000n,
  passiveCapRatioPpm: 1_000_000n,
  passiveSessionCapMs: 60_000,
  minimumQualifiedMs: 1_000,
  renderedMs: 10_000,
  viewableMs: 8_000,
  aiEligibleMs: 6_000,
  qualifiedMs: 6_000,
  passiveMs: 2_000,
  passiveBillableMs: 1_000,
  weightedBillablePpmMs: 6_500_000_000n,
  attestationStatus: 'unverified' as const,
  classificationConfidencePpm: 900_000n,
  fraudRiskStatus: 'unknown' as const,
  unknownEventRatePpm: 0n,
  hypotheticalCurrency: null,
  hypotheticalAdvertiserChargeMinor: null,
  hypotheticalUserRewardMinor: null,
  hypotheticalPlatformContributionMinor: null,
  economicCalculationVersion: null,
  calculationVersion: 'attention-shadow-fact-v1',
  recordDigest: 'd'.repeat(64),
  recordedAt: '2026-08-31T00:01:01.000Z',
};

describe('shadow marketplace metrics', () => {
  it('reconciles durations and labels without treating them as money', () => {
    const result = computeShadowMarketplaceMetrics(
      [fact, { ...fact, sessionKey: 'e'.repeat(64), recordDigest: 'f'.repeat(64) }],
      [
        {
          datasetVersion: 1,
          sessionKey: fact.sessionKey,
          outcomeLabel: 'user_returned',
          outcomeWindowStart: '2026-08-31T00:01:00.000Z',
          outcomeWindowEnd: '2026-09-01T00:01:00.000Z',
          observedAt: '2026-08-31T00:02:00.000Z',
          experimentId: 'experiment-1',
          experimentVariant: 'control',
          policyVersion: 1,
        },
      ],
    );
    expect(result).toMatchObject({
      sessionCount: 2,
      renderedMs: 20_000,
      viewableMs: 16_000,
      qualifiedMs: 12_000,
      qualifiedRatePpm: 750_000,
      viewableRatePpm: 800_000,
      outcomeCounts: { user_returned: 1 },
      financialSideEffects: false,
    });
    expect(result.hypotheticalAdvertiserChargeMinor).toBeNull();
  });
});
