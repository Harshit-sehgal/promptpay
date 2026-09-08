import { describe, expect, it, vi } from 'vitest';

import { AttentionShadowAdminService } from './attention-shadow-admin.service';

describe('attention shadow admin controls', () => {
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
