import { describe, expect, it, vi } from 'vitest';

import { AttentionShadowAdminService } from './attention-shadow-admin.service';

describe('attention shadow admin controls', () => {
  it('reports pending sessions and materializer health without financial state', async () => {
    const prisma = {
      agentSession: { count: vi.fn().mockResolvedValue(4) },
      attentionSessionFact: {
        count: vi
          .fn()
          .mockResolvedValueOnce(9)
          .mockResolvedValueOnce(7)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(8),
      },
      attentionPricingPolicy: {
        findMany: vi.fn().mockResolvedValue([
          {
            version: 2,
            status: 'shadow',
            effectiveAt: new Date('2026-08-30T00:00:00.000Z'),
            retiredAt: null,
          },
        ]),
      },
      attentionModelArtifact: { findMany: vi.fn().mockResolvedValue([]) },
      attentionExperiment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const factCron = {
      getStatus: vi.fn().mockReturnValue({
        configured: true,
        enabled: true,
        running: false,
        lastRunStatus: 'completed',
        lastStartedAt: '2026-08-31T00:00:00.000Z',
        lastCompletedAt: '2026-08-31T00:01:00.000Z',
        lastFailureAt: null,
        lastResult: {
          scanned: 4,
          created: 4,
          duplicates: 0,
          skipped: 0,
          errors: 0,
          financialSideEffects: false,
        },
      }),
    };

    const result = await new AttentionShadowAdminService(
      prisma as never,
      factCron as never,
    ).snapshot();

    expect(result.materializer).toMatchObject({
      pendingSessions: 4,
      configured: true,
      enabled: true,
      lastRunStatus: 'completed',
      lastResult: expect.objectContaining({ created: 4, financialSideEffects: false }),
    });
    expect(prisma.agentSession.count).toHaveBeenCalledWith({
      where: {
        status: { in: ['ended', 'abandoned'] },
        endedAt: { not: null },
        shadowFact: null,
      },
    });
    expect(result.financialSideEffects).toBe(false);
  });

  it('freezes only non-live policies and remains non-financial', async () => {
    const prisma = {
      attentionPricingPolicy: {
        findUnique: vi.fn().mockResolvedValue({ id: 'policy-1', version: 2, status: 'shadow' }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const result = await new AttentionShadowAdminService(prisma as never).freezePolicy(
      2,
      'operator-1',
      'bad shadow fixture',
    );
    expect(result).toEqual({ status: 'frozen', version: 2, financialSideEffects: false });
    expect(prisma.attentionPricingPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'revoked' }) }),
    );
  });

  it('does not allow a canary policy to be changed by the shadow control', async () => {
    const prisma = {
      attentionPricingPolicy: {
        findUnique: vi.fn().mockResolvedValue({ id: 'policy-1', version: 3, status: 'canary' }),
        update: vi.fn(),
      },
    };
    await expect(
      new AttentionShadowAdminService(prisma as never).freezePolicy(3, 'operator-1'),
    ).rejects.toThrow('Wave 6');
    expect(prisma.attentionPricingPolicy.update).not.toHaveBeenCalled();
  });

  it('freezes candidate models explicitly without providing activation', async () => {
    const prisma = {
      attentionModelArtifact: {
        findUnique: vi.fn().mockResolvedValue({ id: 'model-1', status: 'shadow' }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const result = await new AttentionShadowAdminService(prisma as never).freezeModel(
      'model-1',
      'v1',
      'operator-1',
    );
    expect(result).toEqual({
      status: 'frozen',
      modelId: 'model-1',
      modelVersion: 'v1',
      financialSideEffects: false,
    });
  });
});
