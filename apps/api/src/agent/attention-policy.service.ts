import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';

import { type ShadowPolicyRecord, shadowPolicyRecordSchema } from '@ateva/agent-protocol';

import { PrismaService } from '../config/prisma.service';

export type PersistedShadowPolicyResult = {
  status: 'created' | 'duplicate';
  version: number;
  policyDigest: string;
  financialSideEffects: false;
};

/**
 * Write-once policy provisioning for draft/shadow/experiment records. There
 * is intentionally no update or activation method here; the database trigger
 * protects the versioned fields and the admin freeze path only changes status.
 */
@Injectable()
export class AttentionPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async createShadowPolicy(record: ShadowPolicyRecord): Promise<PersistedShadowPolicyResult> {
    const policy = shadowPolicyRecordSchema.parse(record);
    if (!['draft', 'shadow', 'experiment'].includes(policy.status)) {
      throw new Error('only draft, shadow, and experiment policies may be provisioned here');
    }
    if (policyDigestForRecord(policy) !== policy.policyDigest) {
      throw new Error('policyDigest does not match the versioned policy fields');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.attentionPricingPolicy.findUnique({
        where: { version: policy.version },
        select: { policyDigest: true },
      });
      if (existing) {
        if (existing.policyDigest !== policy.policyDigest) {
          throw new ConflictException(
            'Attention policy version already exists with a different digest',
          );
        }
        return {
          status: 'duplicate',
          version: policy.version,
          policyDigest: existing.policyDigest,
          financialSideEffects: false,
        };
      }

      await tx.attentionPricingPolicy.create({
        data: {
          id: policy.id,
          version: policy.version,
          status: policy.status,
          alphaPpm: policy.alphaPpm,
          passiveCapRatioPpm: policy.passiveCapRatioPpm,
          passiveSessionCapMs: policy.passiveSessionCapMs,
          minimumQualifiedMs: policy.minimumQualifiedMs,
          effectiveAt: new Date(policy.effectiveAt),
          retiredAt: policy.retiredAt ? new Date(policy.retiredAt) : null,
          parentPolicyId: policy.parentPolicyId ?? null,
          optimizerModelVersion: policy.modelVersion ?? null,
          trainingWindow: null,
          experimentId: policy.experimentId ?? null,
          policyDigest: policy.policyDigest,
          createdBy: null,
          approvedBy: null,
        },
      });
      return {
        status: 'created',
        version: policy.version,
        policyDigest: policy.policyDigest,
        financialSideEffects: false,
      };
    });
  }
}

export function policyDigestForRecord(record: ShadowPolicyRecord): string {
  const { policyDigest: _ignored, ...versionedFields } = record;
  return createHash('sha256').update(stableSerialize(versionedFields)).digest('hex');
}

function stableSerialize(value: unknown): string {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return 'undefined';
}
