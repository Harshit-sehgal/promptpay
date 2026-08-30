import { z } from 'zod';

export const SHADOW_FEATURE_NAMES = [
  'rendered_ms',
  'viewable_ms',
  'ai_eligible_ms',
  'qualified_ms',
  'passive_ms',
  'passive_billable_ms',
  'weighted_billable_ppm_ms',
  'provider_class',
  'integration_mode',
  'experiment_variant',
  'policy_version',
] as const;

export const shadowFeatureRecordSchema = z
  .object({
    datasetVersion: z.literal(1),
    sessionKey: z.string().regex(/^[a-f0-9]{64}$/),
    environmentKind: z.enum(['development', 'test', 'sandbox', 'staging', 'production']),
    policyVersion: z.number().int().positive(),
    experimentVariant: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .nullable(),
    providerClass: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    integrationMode: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    renderedMs: z.number().int().min(0),
    viewableMs: z.number().int().min(0),
    aiEligibleMs: z.number().int().min(0),
    qualifiedMs: z.number().int().min(0),
    passiveMs: z.number().int().min(0),
    passiveBillableMs: z.number().int().min(0),
    weightedBillablePpmMs: z.bigint().min(0n),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.qualifiedMs > record.viewableMs) {
      context.addIssue({
        code: 'custom',
        path: ['qualifiedMs'],
        message: 'qualifiedMs cannot exceed viewableMs',
      });
    }
    if (record.viewableMs > record.renderedMs) {
      context.addIssue({
        code: 'custom',
        path: ['viewableMs'],
        message: 'viewableMs cannot exceed renderedMs',
      });
    }
    if (record.passiveBillableMs > record.passiveMs) {
      context.addIssue({
        code: 'custom',
        path: ['passiveBillableMs'],
        message: 'passiveBillableMs cannot exceed passiveMs',
      });
    }
  });
export type ShadowFeatureRecord = z.infer<typeof shadowFeatureRecordSchema>;

export function createShadowFeatureRecord(
  input: Omit<ShadowFeatureRecord, 'datasetVersion'>,
): ShadowFeatureRecord {
  return shadowFeatureRecordSchema.parse({ datasetVersion: 1, ...input });
}
