import { describe, expect, it } from 'vitest';

import {
  attentionExperimentAssignmentSchema,
  attentionModelArtifactSchema,
} from './model-contract';

describe('attention model contracts', () => {
  it('accepts a stable experiment assignment and rejects unknown fields', () => {
    const assignment = attentionExperimentAssignmentSchema.parse({
      experimentId: 'experiment-1',
      subjectKey: 'subject-hash',
      variant: 'alpha-050',
      assignedAt: '2026-08-30T00:00:00.000Z',
      policyVersion: 1,
      eligibility: 'eligible',
    });
    expect(assignment.variant).toBe('alpha-050');
    expect(() =>
      attentionExperimentAssignmentSchema.parse({ ...assignment, advertiserId: 'secret' }),
    ).toThrow();
  });

  it('requires validation to begin after training ends', () => {
    const base = {
      modelId: 'advertiser-retention',
      modelVersion: 'v1',
      modelFamily: 'advertiser_retention' as const,
      datasetDigest: 'a'.repeat(64),
      featureNames: ['qualified_ms', 'passive_ms'],
      trainedAt: '2026-08-30T00:00:00.000Z',
      artifactDigest: 'b'.repeat(64),
      status: 'shadow' as const,
    };
    expect(() =>
      attentionModelArtifactSchema.parse({
        ...base,
        trainWindow: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-20T00:00:00.000Z' },
        validationWindow: { start: '2026-08-19T00:00:00.000Z', end: '2026-08-25T00:00:00.000Z' },
      }),
    ).toThrow();
    expect(
      attentionModelArtifactSchema.parse({
        ...base,
        trainWindow: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-20T00:00:00.000Z' },
        validationWindow: { start: '2026-08-21T00:00:00.000Z', end: '2026-08-25T00:00:00.000Z' },
      }).modelVersion,
    ).toBe('v1');
  });
});
