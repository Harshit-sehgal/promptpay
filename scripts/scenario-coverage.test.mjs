import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../scenarios/catalog.json' with { type: 'json' };

import { buildScenarioCoverage } from './scenario-coverage.mjs';

test('coverage report distinguishes executable manifests from the full catalog', () => {
  const report = buildScenarioCoverage([{ catalogId: 11 }, { catalogId: 83 }, { catalogId: 61 }]);
  assert.equal(report.catalogTotal, 90);
  assert.equal(report.covered, 3);
  assert.equal(report.coverageRate, 0.0333);
  assert.equal(report.missing.length, catalog.scenarios.length - 3);
  assert.equal(report.byCategory.terminal_native.covered, 1);
  assert.equal(report.byCategory.reliability.covered, 1);
  assert.equal(report.byCategory.adversarial.covered, 1);
});

test('coverage ignores duplicate and out-of-range manifest IDs', () => {
  const report = buildScenarioCoverage([{ catalogId: 11 }, { catalogId: 11 }, { catalogId: 999 }]);
  assert.equal(report.covered, 1);
});
