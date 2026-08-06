import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { repeatScenario } from './scenario-repeat.mjs';

test('repeated scenario evidence proves stable behavior without exposing traces', async () => {
  const evidence = await repeatScenario(path.resolve('scenarios/sandbox/wrapper-fallback.json'), 3);
  assert.equal(evidence.catalogId, 17);
  assert.equal(evidence.allPassed, true);
  assert.equal(evidence.deterministic, true);
  assert.equal(evidence.uniqueFingerprints, 1);
  assert.equal(evidence.durationMs.length, 3);
  assert.ok(evidence.p50Ms >= 0);
  assert.ok(evidence.p95Ms >= evidence.p50Ms);
  assert.equal('trace' in evidence, false);
});

test('repeat count is bounded', async () => {
  await assert.rejects(
    repeatScenario(path.resolve('scenarios/sandbox/wrapper-fallback.json'), 31),
    /between 2 and 30/,
  );
});
