import { describe, expect, it, vi } from 'vitest';

import { AttentionShadowOutcomeService } from './attention-shadow-outcome.service';

const record = {
  datasetVersion: 1 as const,
  sessionKey: 'a'.repeat(64),
  outcomeLabel: 'user_returned' as const,
  outcomeWindowStart: '2026-08-30T00:00:00.000Z',
  outcomeWindowEnd: '2026-08-31T00:00:00.000Z',
  observedAt: '2026-08-30T01:00:00.000Z',
  experimentId: 'experiment-1',
  experimentVariant: 'control',
  policyVersion: 1,
};

describe('shadow outcome persistence', () => {
  it('stores label-only outcomes idempotently', async () => {
    const tx = {
      attentionExperimentOutcome: {
        findFirst: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AttentionShadowOutcomeService(prisma as never);
    const first = await service.persist(record);
    expect(first.status).toBe('created');
    expect(first.outcomeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(tx.attentionExperimentOutcome.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionKey: record.sessionKey }) }),
    );
  });

  it('rejects conflicting outcomes for the same window', async () => {
    const tx = {
      attentionExperimentOutcome: {
        findFirst: vi.fn().mockResolvedValue({ outcomeDigest: 'e'.repeat(64) }),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    await expect(
      new AttentionShadowOutcomeService(prisma as never).persist(record),
    ).rejects.toThrow('different digest');
  });
});
