import { describe, expect, it, vi } from 'vitest';

import {
  assignAttentionExperimentVariant,
  AttentionExperimentService,
} from './attention-experiment.service';

const subjectKey = 'a'.repeat(64);
const definition = {
  experimentId: 'wait-policy-experiment',
  name: 'Wait policy shadow experiment',
  status: 'running' as const,
  assignmentUnit: 'user' as const,
  variants: [
    { variant: 'control', allocationPpm: 500_000, policyVersion: 1, treatmentParameters: {} },
    { variant: 'treatment', allocationPpm: 500_000, policyVersion: 2, treatmentParameters: {} },
  ],
  assignmentStartedAt: '2026-08-30T00:00:00.000Z',
  assignmentEndedAt: '2026-09-02T00:00:00.000Z',
  outcomeWindowDays: 14,
  primaryMetric: 'qualified_ms',
  guardrailMetrics: ['user_returned'],
};

describe('attention experiment assignment', () => {
  it('is deterministic and respects the assignment window', () => {
    const assigned = assignAttentionExperimentVariant(
      definition,
      subjectKey,
      '2026-08-31T00:00:00.000Z',
    );
    expect(assigned).toEqual(
      assignAttentionExperimentVariant(definition, subjectKey, '2026-08-31T00:00:00.000Z'),
    );
    expect(['control', 'treatment']).toContain(assigned.variant);
    expect(assigned.eligibility).toBe('eligible');

    expect(
      assignAttentionExperimentVariant(definition, subjectKey, '2026-08-29T23:59:59.000Z'),
    ).toMatchObject({ variant: 'ineligible', eligibility: 'ineligible', policyVersion: 1 });
  });

  it('rejects raw subject identifiers at the persistence boundary', () => {
    expect(() =>
      assignAttentionExperimentVariant(definition, 'user@example.com', new Date()),
    ).toThrow('keyed 256-bit digest');
  });

  it('returns an existing assignment on replay', async () => {
    const existing = {
      experimentId: definition.experimentId,
      subjectKey,
      variant: 'control',
      policyVersion: 1,
      eligibility: 'eligible',
      assignedAt: new Date('2026-08-31T00:00:00.000Z'),
    };
    const prisma = {
      attentionExperimentAssignment: { findUnique: vi.fn().mockResolvedValue(existing) },
      attentionExperiment: { findUnique: vi.fn() },
      attentionExperimentAssignmentCreate: vi.fn(),
    };
    const service = new AttentionExperimentService(prisma as never);
    const result = await service.assign(definition.experimentId, subjectKey, existing.assignedAt);
    expect(result).toMatchObject({
      ...existing,
      assignedAt: existing.assignedAt.toISOString(),
      persisted: true,
      financialSideEffects: false,
    });
    expect(prisma.attentionExperimentAssignment.findUnique).toHaveBeenCalledOnce();
  });
});
