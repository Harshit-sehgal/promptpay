import { describe, expect, it, vi } from 'vitest';

import { AttentionShadowDatasetService } from './attention-shadow-dataset.service';

function fact(sessionKey: string, observedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionKey,
    observedAt: new Date(observedAt),
    environmentKind: 'sandbox' as const,
    providerClass: 'claude_code',
    integrationMode: 'native_hook',
    policyVersion: 1,
    alphaPpm: 500_000n,
    passiveCapRatioPpm: 1_000_000n,
    passiveSessionCapMs: 60_000,
    minimumQualifiedMs: 1_000,
    renderedMs: 10_000,
    viewableMs: 8_000,
    aiEligibleMs: 6_000,
    qualifiedMs: 4_000,
    passiveMs: 4_000,
    passiveBillableMs: 2_000,
    weightedBillablePpmMs: 5_000_000_000n,
    classificationConfidencePpm: 950_000n,
    unknownEventRatePpm: 0n,
    ...overrides,
  };
}

describe('AttentionShadowDatasetService', () => {
  it('reads only privacy-safe fact fields and builds a deterministic telemetry manifest', async () => {
    const firstKey = 'a'.repeat(64);
    const secondKey = 'b'.repeat(64);
    const rows = [
      fact(secondKey, '2026-08-02T00:00:00.000Z'),
      fact(firstKey, '2026-08-01T00:00:00.000Z'),
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = { attentionSessionFact: { findMany } };
    const service = new AttentionShadowDatasetService(prisma as never);

    const result = await service.read({
      datasetId: 'telemetry-2026-08',
      datasetVersion: 1,
      sourceWindow: {
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-08-03T00:00:00.000Z',
      },
      featureNames: ['qualified_ms', 'provider_class_claude_code'],
      outcomeName: 'clicked',
      outcomeBySessionKey: new Map([
        [firstKey, 1],
        [secondKey, 0],
      ]),
      generatedAt: '2026-08-04T00:00:00.000Z',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          observedAt: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lt: new Date('2026-08-03T00:00:00.000Z'),
          },
        },
        orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    const query = findMany.mock.calls[0]?.[0] as { select: Record<string, boolean> };
    expect(query.select).not.toHaveProperty('sessionId');
    expect(query.select).not.toHaveProperty('userKey');
    expect(query.select).not.toHaveProperty('deviceKey');
    expect(result).toMatchObject({
      scanned: 2,
      included: 2,
      skippedWithoutOutcome: 0,
      financialSideEffects: false,
      manifest: {
        datasetId: 'telemetry-2026-08',
        source: 'telemetry',
        rowCount: 2,
        outcomeNames: ['clicked'],
      },
    });
    expect(result.observations.map((observation) => observation.id)).toEqual([firstKey, secondKey]);
    expect(result.observations[0]?.features).toEqual({
      qualified_ms: 4_000,
      provider_class_claude_code: 1,
    });
    expect(JSON.stringify(result)).not.toContain('userKey');
    expect(JSON.stringify(result)).not.toContain('deviceKey');
  });

  it('does not synthesize an outcome for an unlabeled fact', async () => {
    const labeledKey = 'c'.repeat(64);
    const unlabeledKey = 'd'.repeat(64);
    const findMany = vi
      .fn()
      .mockResolvedValue([
        fact(unlabeledKey, '2026-08-01T00:00:00.000Z'),
        fact(labeledKey, '2026-08-01T00:01:00.000Z'),
      ]);
    const service = new AttentionShadowDatasetService({
      attentionSessionFact: { findMany },
    } as never);

    const result = await service.read({
      datasetId: 'telemetry-labeled',
      datasetVersion: 1,
      sourceWindow: {
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-08-02T00:00:00.000Z',
      },
      featureNames: ['qualified_ms'],
      outcomeName: 'user_returned',
      outcomeBySessionKey: new Map([[labeledKey, 1]]),
      generatedAt: '2026-08-03T00:00:00.000Z',
    });

    expect(result.scanned).toBe(2);
    expect(result.included).toBe(1);
    expect(result.skippedWithoutOutcome).toBe(1);
    expect(result.observations.map((observation) => observation.id)).toEqual([labeledKey]);
    expect(result.manifest.rowCount).toBe(1);
  });

  it('rejects an invalid time window before querying', async () => {
    const findMany = vi.fn();
    const service = new AttentionShadowDatasetService({
      attentionSessionFact: { findMany },
    } as never);

    await expect(
      service.read({
        datasetId: 'invalid-window',
        datasetVersion: 1,
        sourceWindow: {
          start: '2026-08-02T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        featureNames: ['qualified_ms'],
        outcomeName: 'clicked',
        outcomeBySessionKey: new Map(),
        generatedAt: '2026-08-03T00:00:00.000Z',
      }),
    ).rejects.toThrow('positive duration');
    expect(findMany).not.toHaveBeenCalled();
  });
});
