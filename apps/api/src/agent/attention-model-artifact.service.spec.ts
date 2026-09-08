import { describe, expect, it, vi } from 'vitest';

import { AttentionModelArtifactService } from './attention-model-artifact.service';
import { trainResponseModel } from './attention-response-model';

const observations = Array.from({ length: 6 }, (_, index) => ({
  id: (index + 1).toString(16).padStart(64, '0'),
  observedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  features: { qualified_ms: 1_000 + index * 100 },
  outcome: index % 2,
}));

function trained() {
  return trainResponseModel({
    modelId: 'artifact-test',
    modelVersion: 'v1',
    modelFamily: 'advertiser_outcome',
    datasetId: 'artifact-dataset',
    datasetVersion: 1,
    datasetSource: 'shadow_fixture',
    featureNames: ['qualified_ms'],
    outcomeName: 'clicked',
    observations,
    trainWindow: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-03T00:00:00.000Z' },
    validationWindow: { start: '2026-08-03T00:00:00.000Z', end: '2026-08-05T00:00:00.000Z' },
    testWindow: { start: '2026-08-05T00:00:00.000Z', end: '2026-08-08T00:00:00.000Z' },
    trainedAt: '2026-08-31T00:00:00.000Z',
    bootstrapReplicates: 20,
    iterations: 50,
  });
}

describe('attention model artifact persistence', () => {
  it('persists coefficients as metadata and accepts identical replays', async () => {
    const result = trained();
    const tx = {
      attentionModelArtifact: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ artifactDigest: result.artifact.artifactDigest }),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AttentionModelArtifactService(prisma as never);
    await expect(service.persist(result)).resolves.toMatchObject({
      status: 'created',
      financialSideEffects: false,
    });
    await expect(service.persist(result)).resolves.toMatchObject({ status: 'duplicate' });
    expect(tx.attentionModelArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelParameters: expect.objectContaining({
            parameterVersion: 'interpretable-response-model-v1',
          }),
        }),
      }),
    );
  });

  it('rejects a conflicting immutable model version', async () => {
    const result = trained();
    const tx = {
      attentionModelArtifact: {
        findUnique: vi.fn().mockResolvedValue({ artifactDigest: 'e'.repeat(64) }),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    await expect(
      new AttentionModelArtifactService(prisma as never).persist(result),
    ).rejects.toThrow('different digest');
    expect(tx.attentionModelArtifact.create).not.toHaveBeenCalled();
  });

  it('rejects a self-asserted artifact digest', async () => {
    const result = trained();
    const prisma = { $transaction: vi.fn() };
    await expect(
      new AttentionModelArtifactService(prisma as never).persist({
        ...result,
        artifact: { ...result.artifact, artifactDigest: 'e'.repeat(64) },
      }),
    ).rejects.toThrow('artifactDigest does not match');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
