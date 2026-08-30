import { describe, expect, it, vi } from 'vitest';

import { AttentionPolicyService, policyDigestForRecord } from './attention-policy.service';

const unsigned = {
  id: 'policy-1',
  version: 1,
  status: 'shadow' as const,
  alphaPpm: 500_000n,
  passiveCapRatioPpm: 1_000_000n,
  passiveSessionCapMs: 60_000,
  minimumQualifiedMs: 1_000,
  effectiveAt: '2026-08-31T00:00:00.000Z',
  parentPolicyId: null,
  modelVersion: null,
  experimentId: null,
  policyDigest: '',
};
const policy = { ...unsigned, policyDigest: policyDigestForRecord(unsigned as never) };

describe('attention policy persistence', () => {
  it('writes a digest-bound shadow policy once', async () => {
    const tx = {
      attentionPricingPolicy: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const result = await new AttentionPolicyService(prisma as never).createShadowPolicy(policy);
    expect(result).toEqual({
      status: 'created',
      version: 1,
      policyDigest: policy.policyDigest,
      financialSideEffects: false,
    });
    expect(tx.attentionPricingPolicy.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1, status: 'shadow' }) }),
    );
  });

  it('rejects a digest mismatch and live status provisioning', async () => {
    const prisma = { $transaction: vi.fn() };
    const service = new AttentionPolicyService(prisma as never);
    await expect(
      service.createShadowPolicy({ ...policy, policyDigest: 'e'.repeat(64) }),
    ).rejects.toThrow('policyDigest');
    await expect(service.createShadowPolicy({ ...policy, status: 'active' })).rejects.toThrow(
      'provisioned here',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
