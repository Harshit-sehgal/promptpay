import { z } from 'zod';

export const attentionExperimentStatusSchema = z.enum(['draft', 'running', 'paused', 'completed']);
export type AttentionExperimentStatus = z.infer<typeof attentionExperimentStatusSchema>;

const boundedIdentifier = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const attentionExperimentVariantSchema = z
  .object({
    variant: boundedIdentifier,
    allocationPpm: z.number().int().min(0).max(1_000_000),
    policyVersion: z.number().int().positive(),
    treatmentParameters: z.record(
      z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
  })
  .strict();
export type AttentionExperimentVariant = z.infer<typeof attentionExperimentVariantSchema>;

export const attentionExperimentDefinitionSchema = z
  .object({
    experimentId: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    status: attentionExperimentStatusSchema,
    assignmentUnit: z.enum(['user', 'device', 'session']),
    variants: z.array(attentionExperimentVariantSchema).min(2).max(16),
    assignmentStartedAt: z.string().datetime({ offset: true }).nullable(),
    assignmentEndedAt: z.string().datetime({ offset: true }).nullable(),
    outcomeWindowDays: z.number().int().min(1).max(90),
    primaryMetric: boundedIdentifier,
    guardrailMetrics: z.array(boundedIdentifier).max(32),
  })
  .strict()
  .superRefine((experiment, context) => {
    const total = experiment.variants.reduce((sum, variant) => sum + variant.allocationPpm, 0);
    if (total !== 1_000_000) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'variant allocation must total exactly 1,000,000 ppm',
      });
    }
    const variants = new Set(experiment.variants.map((variant) => variant.variant));
    if (variants.size !== experiment.variants.length) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'variant identifiers must be unique',
      });
    }
    if (
      experiment.assignmentStartedAt &&
      experiment.assignmentEndedAt &&
      Date.parse(experiment.assignmentEndedAt) <= Date.parse(experiment.assignmentStartedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assignmentEndedAt'],
        message: 'assignment window must end after it starts',
      });
    }
  });
export type AttentionExperimentDefinition = z.infer<typeof attentionExperimentDefinitionSchema>;

export const attentionExperimentAssignmentSchema = z
  .object({
    experimentId: z.string().min(1).max(128),
    subjectKey: z.string().regex(/^[a-f0-9]{64}$/),
    variant: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    assignedAt: z.string().datetime({ offset: true }),
    policyVersion: z.number().int().positive(),
    eligibility: z.enum(['eligible', 'ineligible']),
  })
  .strict();
export type AttentionExperimentAssignment = z.infer<typeof attentionExperimentAssignmentSchema>;

export const attentionModelArtifactSchema = z
  .object({
    modelId: z.string().min(1).max(128),
    modelVersion: z.string().min(1).max(128),
    modelFamily: z.enum([
      'advertiser_outcome',
      'advertiser_retention',
      'user_retention',
      'cost',
      'fraud_quality_risk',
    ]),
    datasetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    featureNames: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(256),
    trainWindow: z
      .object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
      })
      .strict(),
    validationWindow: z
      .object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
      })
      .strict(),
    testWindow: z
      .object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
      })
      .strict(),
    trainedAt: z.string().datetime({ offset: true }),
    artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['candidate', 'shadow', 'approved', 'retired', 'revoked']),
    calibration: z
      .object({
        method: z.enum(['none', 'platt', 'isotonic']),
        brierScorePpm: z.number().int().min(0).max(1_000_000),
        expectedCalibrationErrorPpm: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
    uncertainty: z
      .object({
        method: z.enum(['bootstrap', 'analytic', 'none']),
        confidenceLevelPpm: z.number().int().min(0).max(1_000_000),
        sampleSize: z.number().int().min(0),
        lowerBound: z.number().finite(),
        upperBound: z.number().finite(),
      })
      .strict(),
    rollback: z
      .object({
        previousModelVersion: z.string().min(1).max(128).nullable(),
        rollbackOnDrift: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (Date.parse(artifact.trainWindow.end) > Date.parse(artifact.validationWindow.start)) {
      context.addIssue({
        code: 'custom',
        path: ['validationWindow'],
        message: 'validation must begin after training ends',
      });
    }
    if (Date.parse(artifact.validationWindow.end) > Date.parse(artifact.testWindow.start)) {
      context.addIssue({
        code: 'custom',
        path: ['testWindow'],
        message: 'test evaluation must begin after validation ends',
      });
    }
    if (
      Date.parse(artifact.trainWindow.end) <= Date.parse(artifact.trainWindow.start) ||
      Date.parse(artifact.validationWindow.end) <= Date.parse(artifact.validationWindow.start) ||
      Date.parse(artifact.testWindow.end) <= Date.parse(artifact.testWindow.start)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['trainWindow'],
        message: 'all model windows must have positive duration',
      });
    }
  });
export type AttentionModelArtifact = z.infer<typeof attentionModelArtifactSchema>;

export const attentionDatasetManifestSchema = z
  .object({
    datasetId: z.string().min(1).max(128),
    datasetVersion: z.number().int().positive(),
    sourceWindow: z
      .object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
      })
      .strict(),
    rowCount: z.number().int().min(0),
    featureNames: z.array(boundedIdentifier).max(256),
    outcomeNames: z.array(boundedIdentifier).max(64),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: z.string().datetime({ offset: true }),
    source: z.enum(['telemetry', 'experiment', 'shadow_fixture']),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (Date.parse(manifest.sourceWindow.end) <= Date.parse(manifest.sourceWindow.start)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceWindow'],
        message: 'dataset source window must end after it starts',
      });
    }
  });
export type AttentionDatasetManifest = z.infer<typeof attentionDatasetManifestSchema>;
