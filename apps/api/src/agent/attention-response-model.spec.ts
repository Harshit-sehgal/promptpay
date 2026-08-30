import { describe, expect, it } from 'vitest';

import {
  buildAttentionDatasetManifest,
  MODEL_FEATURE_ALLOWLIST,
  type ModelObservation,
  predictResponseModel,
  ShadowModelRegistry,
  splitTemporalObservations,
  trainResponseModel,
  validateModelObservations,
} from './attention-response-model';

const featureNames = ['qualified_ms', 'viewable_ms', 'policy_version'] as const;
const observations: ModelObservation[] = Array.from({ length: 8 }, (_, index) => ({
  id: (index + 1).toString(16).padStart(64, '0'),
  observedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  features: {
    qualified_ms: 1_000 + index * 100,
    viewable_ms: 2_000 + index * 100,
    policy_version: index < 4 ? 1 : 2,
  },
  outcome: index % 3 === 0 ? 1 : 0,
}));

const windows = {
  train: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-05T00:00:00.000Z' },
  validation: { start: '2026-08-05T00:00:00.000Z', end: '2026-08-07T00:00:00.000Z' },
  test: { start: '2026-08-07T00:00:00.000Z', end: '2026-08-10T00:00:00.000Z' },
};

function trainingRequest(modelFamily: 'advertiser_outcome' | 'cost' = 'advertiser_outcome') {
  return {
    modelId: 'advertiser-value-v1',
    modelVersion: '2026-08-31.1',
    modelFamily,
    datasetId: 'shadow-sessions-2026-08',
    datasetVersion: 1,
    datasetSource: 'shadow_fixture' as const,
    featureNames,
    outcomeName: modelFamily === 'cost' ? 'hypothetical_cost' : 'advertiser_clicked',
    observations:
      modelFamily === 'cost'
        ? observations.map((observation) => ({
            ...observation,
            outcome: 10 + observation.features.qualified_ms / 1_000,
          }))
        : observations,
    trainWindow: windows.train,
    validationWindow: windows.validation,
    testWindow: windows.test,
    trainedAt: '2026-08-31T00:00:00.000Z',
    bootstrapReplicates: 40,
    iterations: 200,
  };
}

describe('attention response models', () => {
  it('builds a digest-only manifest and deterministic temporal splits', () => {
    const manifest = buildAttentionDatasetManifest({
      datasetId: 'shadow-sessions-2026-08',
      datasetVersion: 1,
      sourceWindow: { start: windows.train.start, end: windows.test.end },
      featureNames,
      outcomeNames: ['advertiser_clicked'],
      observations,
      generatedAt: '2026-08-31T00:00:00.000Z',
      source: 'shadow_fixture',
    });
    expect(manifest).toMatchObject({ datasetId: 'shadow-sessions-2026-08', rowCount: 8 });
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain(observations[0].id);

    const splits = splitTemporalObservations(observations, windows);
    expect(splits.train).toHaveLength(4);
    expect(splits.validation).toHaveLength(2);
    expect(splits.test).toHaveLength(2);
  });

  it('trains an interpretable calibrated-metadata artifact without retaining rows', () => {
    const first = trainResponseModel(trainingRequest());
    const second = trainResponseModel(trainingRequest());

    expect(first).toEqual(second);
    expect(first.model.link).toBe('logistic');
    expect(first.model.featureNames).toEqual(featureNames);
    expect(first.artifact).toMatchObject({
      modelId: 'advertiser-value-v1',
      status: 'shadow',
      datasetDigest: first.datasetManifest.digest,
      calibration: { method: 'none' },
      uncertainty: { method: 'bootstrap', sampleSize: 2 },
      rollback: { rollbackOnDrift: true, previousModelVersion: null },
    });
    expect(first.artifact.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first.model)).not.toContain(observations[0].id);
    expect(first.financialSideEffects).toBe(false);
    expect(predictResponseModel(first.model, observations[0].features)).toBeGreaterThanOrEqual(0);
    expect(predictResponseModel(first.model, observations[0].features)).toBeLessThanOrEqual(1);
  });

  it('supports continuous cost models with the same safe artifact contract', () => {
    const result = trainResponseModel(trainingRequest('cost'));
    expect(result.model.link).toBe('identity');
    expect(result.artifact.modelFamily).toBe('cost');
    expect(result.evaluations.every((evaluation) => evaluation.sampleSize > 0)).toBe(true);
  });

  it('rejects leakage-shaped or future data instead of guessing around it', () => {
    expect(() =>
      validateModelObservations(
        [{ ...observations[0], features: { ...observations[0].features, prompt: 1 } }],
        ['qualified_ms'],
        'advertiser_outcome',
      ),
    ).toThrow('non-allowlisted feature');
    expect(() =>
      splitTemporalObservations(
        [
          ...observations,
          { ...observations[0], id: 'f'.repeat(64), observedAt: '2026-08-11T00:00:00.000Z' },
        ],
        windows,
      ),
    ).toThrow('outside the declared temporal windows');
    expect(MODEL_FEATURE_ALLOWLIST).not.toContain('prompt');
  });

  it('keeps model registration shadow-only and supports explicit freezing', () => {
    const trained = trainResponseModel(trainingRequest());
    const registry = new ShadowModelRegistry();
    const registered = registry.register(trained);
    expect(registered.frozen).toBe(false);
    expect(registry.get(trained.artifact.modelId, trained.artifact.modelVersion)).toBe(registered);
    expect(registry.freeze(trained.artifact.modelId, trained.artifact.modelVersion).frozen).toBe(
      true,
    );
    expect(registry.list()).toHaveLength(1);
  });
});
