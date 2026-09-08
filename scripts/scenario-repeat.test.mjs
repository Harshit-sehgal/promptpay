import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { percentile, repeatScenario, validateRepeatEvidence } from './scenario-repeat.mjs';

test('percentile uses nearest-rank output and handles small samples', () => {
  const durations = [40, 10, 30, 20];
  assert.equal(percentile(durations, 0.5), 20);
  assert.equal(percentile(durations, 0.95), 40);
  assert.equal(percentile(durations, 0.99), 40);
  assert.equal(percentile([], 0.99), null);
});

test('percentile rejects invalid input', () => {
  assert.throws(() => percentile([10, Number.NaN], 0.99), /non-negative finite/);
  assert.throws(() => percentile([10], 0), /greater than 0/);
  assert.throws(() => percentile([10], 1.1), /at most 1/);
});

test('repeated scenario evidence proves stable behavior without exposing traces', async () => {
  const evidence = await repeatScenario(path.resolve('scenarios/sandbox/wrapper-fallback.json'), 3);
  assert.equal(evidence.catalogId, 17);
  assert.equal(evidence.allPassed, true);
  assert.equal(evidence.deterministic, true);
  assert.equal(evidence.uniqueFingerprints, 1);
  assert.equal(evidence.durationMs.length, 3);
  assert.ok(evidence.p50Ms >= 0);
  assert.ok(evidence.p95Ms >= evidence.p50Ms);
  assert.ok(evidence.p99Ms >= evidence.p95Ms);
  assert.deepEqual(validateRepeatEvidence(evidence), []);
  assert.equal('trace' in evidence, false);
});

test('repeat evidence rejects invalid percentile ordering and range', () => {
  const errors = validateRepeatEvidence({
    repetitions: 3,
    durationMs: [10, 20, 30],
    p50Ms: 20,
    p95Ms: 15,
    p99Ms: 31,
  });
  assert.match(errors.join('\n'), /p95Ms must be at least p50Ms/);
  assert.match(errors.join('\n'), /p95Ms must equal the percentile/);
  assert.match(errors.join('\n'), /p99Ms must not exceed the maximum/);
});

test('repeat count is bounded', async () => {
  await assert.rejects(
    repeatScenario(path.resolve('scenarios/sandbox/wrapper-fallback.json'), 31),
    /between 2 and 30/,
  );
});
