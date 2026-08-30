import { z } from 'zod';

import { ATTENTION_PPM_SCALE } from './attention-contract';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const dimensionSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const environmentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/i);
const environmentKindSchema = z.enum(['development', 'test', 'sandbox', 'staging', 'production']);

export const shadowAttestationStatusSchema = z.enum([
  'not_available',
  'unverified',
  'verified',
  'expired',
  'rejected',
]);
export type ShadowAttestationStatus = z.infer<typeof shadowAttestationStatusSchema>;

export const shadowFraudRiskStatusSchema = z.enum(['unknown', 'low', 'medium', 'high', 'blocked']);
export type ShadowFraudRiskStatus = z.infer<typeof shadowFraudRiskStatusSchema>;

/**
 * Immutable, privacy-minimized facts for one completed agent session.
 *
 * `userKey`, `deviceKey`, and `sessionKey` are keyed digests. They are not
 * provider identifiers and must never be populated with raw IDs. The
 * hypothetical economics fields are nullable because a shadow policy may be
 * evaluated before an operator has supplied a simulation rate card. Non-null
 * values are still explicitly hypothetical and cannot authorize money.
 */
export const shadowSessionFactSchema = z
  .object({
    datasetVersion: z.literal(1),
    sessionKey: digestSchema,
    userKey: digestSchema,
    deviceKey: digestSchema,
    observedAt: z.string().datetime({ offset: true }),
    sessionStartedAt: z.string().datetime({ offset: true }),
    sessionEndedAt: z.string().datetime({ offset: true }),
    environmentKind: environmentKindSchema,
    environmentId: environmentIdSchema,
    providerClass: dimensionSchema,
    integrationMode: dimensionSchema,
    toolClass: dimensionSchema.nullable(),
    policyVersion: z.number().int().positive(),
    alphaPpm: z.bigint().min(0n).max(ATTENTION_PPM_SCALE),
    passiveCapRatioPpm: z.bigint().min(0n).max(ATTENTION_PPM_SCALE),
    passiveSessionCapMs: z.number().int().min(0),
    minimumQualifiedMs: z.number().int().min(0),
    renderedMs: z.number().int().min(0),
    viewableMs: z.number().int().min(0),
    aiEligibleMs: z.number().int().min(0),
    qualifiedMs: z.number().int().min(0),
    passiveMs: z.number().int().min(0),
    passiveBillableMs: z.number().int().min(0),
    weightedBillablePpmMs: z.bigint().min(0n),
    attestationStatus: shadowAttestationStatusSchema,
    classificationConfidencePpm: z.bigint().min(0n).max(ATTENTION_PPM_SCALE),
    fraudRiskStatus: shadowFraudRiskStatusSchema,
    unknownEventRatePpm: z.bigint().min(0n).max(ATTENTION_PPM_SCALE),
    hypotheticalCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    hypotheticalAdvertiserChargeMinor: z.bigint().min(0n).nullable(),
    hypotheticalUserRewardMinor: z.bigint().min(0n).nullable(),
    hypotheticalPlatformContributionMinor: z.bigint().min(0n).nullable(),
    economicCalculationVersion: z.string().min(1).max(128).nullable(),
    calculationVersion: z.string().min(1).max(128),
    recordDigest: digestSchema,
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((fact, context) => {
    if (Date.parse(fact.sessionEndedAt) < Date.parse(fact.sessionStartedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['sessionEndedAt'],
        message: 'session end cannot precede session start',
      });
    }
    if (fact.viewableMs > fact.renderedMs) {
      context.addIssue({
        code: 'custom',
        path: ['viewableMs'],
        message: 'viewableMs cannot exceed renderedMs',
      });
    }
    if (fact.qualifiedMs > fact.viewableMs || fact.qualifiedMs > fact.aiEligibleMs) {
      context.addIssue({
        code: 'custom',
        path: ['qualifiedMs'],
        message: 'qualifiedMs must be within both viewable and AI-eligible time',
      });
    }
    if (fact.passiveMs !== fact.viewableMs - fact.qualifiedMs) {
      context.addIssue({
        code: 'custom',
        path: ['passiveMs'],
        message: 'passiveMs must equal viewableMs minus qualifiedMs',
      });
    }
    if (fact.passiveBillableMs > fact.passiveMs) {
      context.addIssue({
        code: 'custom',
        path: ['passiveBillableMs'],
        message: 'passiveBillableMs cannot exceed passiveMs',
      });
    }
    if (fact.qualifiedMs === 0 && fact.passiveBillableMs !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['passiveBillableMs'],
        message: 'passive billing must be zero when qualified time is zero',
      });
    }
    if (
      fact.qualifiedMs === 0 &&
      fact.hypotheticalUserRewardMinor !== null &&
      fact.hypotheticalUserRewardMinor !== 0n
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hypotheticalUserRewardMinor'],
        message: 'hypothetical user reward must be zero when qualified time is zero',
      });
    }

    const passiveRatioCapMs =
      (BigInt(fact.qualifiedMs) * fact.passiveCapRatioPpm) / ATTENTION_PPM_SCALE;
    if (
      BigInt(fact.passiveBillableMs) > passiveRatioCapMs ||
      fact.passiveBillableMs > fact.passiveSessionCapMs
    ) {
      context.addIssue({
        code: 'custom',
        path: ['passiveBillableMs'],
        message: 'passiveBillableMs exceeds the policy cap',
      });
    }

    const expectedWeighted =
      BigInt(fact.qualifiedMs) * ATTENTION_PPM_SCALE +
      BigInt(fact.passiveBillableMs) * fact.alphaPpm;
    if (fact.weightedBillablePpmMs !== expectedWeighted) {
      context.addIssue({
        code: 'custom',
        path: ['weightedBillablePpmMs'],
        message: 'weighted billable time does not match the fixed-point policy calculation',
      });
    }

    const hypotheticalValues = [
      fact.hypotheticalCurrency,
      fact.hypotheticalAdvertiserChargeMinor,
      fact.hypotheticalUserRewardMinor,
      fact.hypotheticalPlatformContributionMinor,
      fact.economicCalculationVersion,
    ];
    const hasSomeHypotheticalValue = hypotheticalValues.some((value) => value !== null);
    const hasAllHypotheticalValues = hypotheticalValues.every((value) => value !== null);
    if (hasSomeHypotheticalValue && !hasAllHypotheticalValues) {
      context.addIssue({
        code: 'custom',
        path: ['hypotheticalCurrency'],
        message: 'hypothetical economics must be supplied as a complete set or all null',
      });
    }
    if (hasAllHypotheticalValues) {
      const charge = fact.hypotheticalAdvertiserChargeMinor as bigint;
      const reward = fact.hypotheticalUserRewardMinor as bigint;
      const contribution = fact.hypotheticalPlatformContributionMinor as bigint;
      if (charge < reward || contribution !== charge - reward) {
        context.addIssue({
          code: 'custom',
          path: ['hypotheticalPlatformContributionMinor'],
          message: 'hypothetical contribution must equal charge minus reward',
        });
      }
    }
  });

export type ShadowSessionFact = z.infer<typeof shadowSessionFactSchema>;

export function createShadowSessionFact(
  input: Omit<ShadowSessionFact, 'datasetVersion'>,
): ShadowSessionFact {
  return shadowSessionFactSchema.parse({ datasetVersion: 1, ...input });
}
