import { z } from 'zod';

export const attentionExperimentStatusSchema = z.enum(['draft', 'running', 'paused', 'completed']);
export type AttentionExperimentStatus = z.infer<typeof attentionExperimentStatusSchema>;

export const attentionExperimentAssignmentSchema = z
  .object({
    experimentId: z.string().min(1).max(128),
    subjectKey: z.string().min(1).max(256),
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
    modelFamily: z.enum(['advertiser_outcome', 'advertiser_retention', 'user_retention', 'cost']),
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
    trainedAt: z.string().datetime({ offset: true }),
    artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['candidate', 'shadow', 'approved', 'retired', 'revoked']),
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
  });
export type AttentionModelArtifact = z.infer<typeof attentionModelArtifactSchema>;
