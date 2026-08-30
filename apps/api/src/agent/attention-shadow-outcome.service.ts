import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';

import { PrismaService } from '../config/prisma.service';
import { type ShadowOutcomeRecord, shadowOutcomeRecordSchema } from './attention-shadow-outcomes';

export type PersistedShadowOutcomeResult = {
  status: 'created' | 'duplicate';
  outcomeDigest: string;
  financialSideEffects: false;
};

/** Persist only a validated, label-only shadow outcome projection. */
@Injectable()
export class AttentionShadowOutcomeService {
  constructor(private readonly prisma: PrismaService) {}

  async persist(record: ShadowOutcomeRecord): Promise<PersistedShadowOutcomeResult> {
    const validated = shadowOutcomeRecordSchema.parse(record);
    const experimentId = validated.experimentId;
    if (!experimentId) throw new Error('experimentId is required for persistence');
    const outcomeDigest = sha256(stableSerialize(validated));

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.attentionExperimentOutcome.findFirst({
        where: {
          experimentId,
          sessionKey: validated.sessionKey,
          outcomeLabel: validated.outcomeLabel,
          outcomeWindowStart: new Date(validated.outcomeWindowStart),
        },
        select: { outcomeDigest: true },
      });
      if (existing) {
        if (existing.outcomeDigest !== outcomeDigest) {
          throw new ConflictException('Shadow outcome already exists with a different digest');
        }
        return { status: 'duplicate', outcomeDigest, financialSideEffects: false };
      }

      await tx.attentionExperimentOutcome.create({
        data: {
          id: outcomeDigest.slice(0, 32),
          experimentId,
          sessionKey: validated.sessionKey,
          outcomeLabel: validated.outcomeLabel,
          outcomeWindowStart: new Date(validated.outcomeWindowStart),
          outcomeWindowEnd: new Date(validated.outcomeWindowEnd),
          observedAt: new Date(validated.observedAt),
          experimentVariant: validated.experimentVariant,
          policyVersion: validated.policyVersion,
          outcomeDigest,
        },
      });
      return { status: 'created', outcomeDigest, financialSideEffects: false };
    });
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableSerialize(value: unknown): string {
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
