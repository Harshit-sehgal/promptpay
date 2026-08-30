import { z } from 'zod';

export const shadowOutcomeLabelSchema = z.enum([
  'clicked',
  'converted',
  'campaign_replenished',
  'campaign_paused',
  'user_returned',
  'ad_disabled',
  'installation_retained',
  'fraud_flagged',
  'none_observed',
]);
export type ShadowOutcomeLabel = z.infer<typeof shadowOutcomeLabelSchema>;

export const shadowOutcomeRecordSchema = z
  .object({
    datasetVersion: z.literal(1),
    sessionKey: z.string().regex(/^[a-f0-9]{64}$/),
    outcomeLabel: shadowOutcomeLabelSchema,
    outcomeWindowStart: z.string().datetime({ offset: true }),
    outcomeWindowEnd: z.string().datetime({ offset: true }),
    observedAt: z.string().datetime({ offset: true }),
    experimentId: z.string().min(1).max(128).nullable(),
    experimentVariant: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .nullable(),
    policyVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((record, context) => {
    if (Date.parse(record.outcomeWindowEnd) <= Date.parse(record.outcomeWindowStart)) {
      context.addIssue({
        code: 'custom',
        path: ['outcomeWindowEnd'],
        message: 'outcome window must end after it starts',
      });
    }
  });
export type ShadowOutcomeRecord = z.infer<typeof shadowOutcomeRecordSchema>;

export function createShadowOutcomeRecord(
  input: Omit<ShadowOutcomeRecord, 'datasetVersion'>,
): ShadowOutcomeRecord {
  return shadowOutcomeRecordSchema.parse({ datasetVersion: 1, ...input });
}
