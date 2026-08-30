import { z } from 'zod';

/** Fixed-point scale used for policy ratios and multipliers. */
export const ATTENTION_PPM_SCALE = 1_000_000n;

export const attentionStateSchema = z.enum([
  'user_active',
  'ai_processing',
  'tool_processing',
  'user_input_required',
  'idle',
  'not_viewable',
]);
export type AttentionState = z.infer<typeof attentionStateSchema>;

export const shadowAttentionMeasurementSchema = z
  .object({
    renderedMs: z.number().int().min(0),
    viewableMs: z.number().int().min(0),
    aiEligibleMs: z.number().int().min(0),
    qualifiedMs: z.number().int().min(0),
    passiveMs: z.number().int().min(0),
    passiveBillableMs: z.number().int().min(0),
    weightedBillablePpmMs: z.bigint().min(0n),
  })
  .strict();
export type ShadowAttentionMeasurement = z.infer<typeof shadowAttentionMeasurementSchema>;

export const attentionPolicyStatusSchema = z.enum([
  'draft',
  'shadow',
  'experiment',
  'canary',
  'active',
  'retired',
  'revoked',
]);
export type AttentionPolicyStatus = z.infer<typeof attentionPolicyStatusSchema>;

export const shadowAttentionPolicySchema = z
  .object({
    version: z.number().int().positive(),
    status: attentionPolicyStatusSchema,
    alphaPpm: z.bigint().min(0n).max(ATTENTION_PPM_SCALE),
    passiveCapRatioPpm: z.bigint().min(0n),
    passiveSessionCapMs: z.number().int().min(0),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.passiveCapRatioPpm > ATTENTION_PPM_SCALE) {
      context.addIssue({
        code: 'too_big',
        maximum: Number(ATTENTION_PPM_SCALE),
        origin: 'bigint',
        inclusive: true,
        path: ['passiveCapRatioPpm'],
        message: 'passiveCapRatioPpm must not exceed one-to-one',
      });
    }
  });
export type ShadowAttentionPolicy = z.infer<typeof shadowAttentionPolicySchema>;

export type ShadowSessionPolicyAssignment = {
  sessionId: string;
  policyVersion: number;
  assignedAt: string;
};

/** Build the additive persistence shape for a shadow policy without money fields. */
export const shadowPolicyRecordSchema = z
  .object({
    id: z.string().min(1).max(128),
    version: z.number().int().positive(),
    status: attentionPolicyStatusSchema,
    alphaPpm: z.bigint().min(0n).max(ATTENTION_PPM_SCALE),
    passiveCapRatioPpm: z.bigint().min(0n).max(ATTENTION_PPM_SCALE),
    passiveSessionCapMs: z.number().int().min(0),
    effectiveAt: z.string().datetime({ offset: true }),
    retiredAt: z.string().datetime({ offset: true }).nullable().optional(),
    parentPolicyId: z.string().min(1).max(128).nullable().optional(),
    modelVersion: z.string().min(1).max(128).nullable().optional(),
    experimentId: z.string().min(1).max(128).nullable().optional(),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ShadowPolicyRecord = z.infer<typeof shadowPolicyRecordSchema>;

/** A session assignment is immutable: policy changes affect future sessions. */
export function assignShadowPolicyToSession(
  sessionId: string,
  policy: ShadowAttentionPolicy,
  assignedAt: string,
): ShadowSessionPolicyAssignment {
  if (!sessionId) throw new Error('sessionId is required');
  if (!Number.isFinite(Date.parse(assignedAt))) throw new Error('assignedAt must be a date');
  if (policy.status === 'revoked' || policy.status === 'retired') {
    throw new Error('A retired or revoked policy cannot start a session');
  }
  return { sessionId, policyVersion: policy.version, assignedAt };
}

export function evaluateShadowAttention(
  input: Pick<ShadowAttentionMeasurement, 'renderedMs' | 'viewableMs' | 'aiEligibleMs'>,
  policy: ShadowAttentionPolicy,
): ShadowAttentionMeasurement {
  assertDurationOrder(input);
  const qualifiedMs = Math.min(input.viewableMs, input.aiEligibleMs);
  const passiveMs = input.viewableMs - qualifiedMs;
  const ratioCapMs = multiplyPpmFloor(qualifiedMs, policy.passiveCapRatioPpm);
  const passiveBillableMs = Math.min(passiveMs, ratioCapMs, policy.passiveSessionCapMs);
  const weightedBillablePpmMs =
    BigInt(qualifiedMs) * ATTENTION_PPM_SCALE + BigInt(passiveBillableMs) * policy.alphaPpm;

  return shadowAttentionMeasurementSchema.parse({
    ...input,
    qualifiedMs,
    passiveMs,
    passiveBillableMs,
    weightedBillablePpmMs,
  });
}

function assertDurationOrder(input: {
  renderedMs: number;
  viewableMs: number;
  aiEligibleMs: number;
}): void {
  if (input.viewableMs > input.renderedMs) {
    throw new Error('viewableMs cannot exceed renderedMs');
  }
}

function multiplyPpmFloor(value: number, ppm: bigint): number {
  const result = (BigInt(value) * ppm) / ATTENTION_PPM_SCALE;
  return result > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(result);
}
