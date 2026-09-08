import { z } from 'zod';

import { ShadowFeatureRecord, shadowFeatureRecordSchema } from './attention-shadow-feature';
import { ShadowOutcomeRecord, shadowOutcomeRecordSchema } from './attention-shadow-outcomes';

export const shadowModelInputSchema = z
  .object({
    datasetVersion: z.literal(1),
    feature: shadowFeatureRecordSchema,
    outcome: shadowOutcomeRecordSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.outcome && input.outcome.sessionKey !== input.feature.sessionKey) {
      context.addIssue({
        code: 'custom',
        path: ['outcome', 'sessionKey'],
        message: 'outcome session key must match feature session key',
      });
    }
    if (input.outcome && input.outcome.policyVersion !== input.feature.policyVersion) {
      context.addIssue({
        code: 'custom',
        path: ['outcome', 'policyVersion'],
        message: 'outcome policy version must match feature policy version',
      });
    }
  });
export type ShadowModelInput = z.infer<typeof shadowModelInputSchema>;

export function createShadowModelInput(
  feature: ShadowFeatureRecord,
  outcome: ShadowOutcomeRecord | null = null,
): ShadowModelInput {
  return shadowModelInputSchema.parse({ datasetVersion: 1, feature, outcome });
}
