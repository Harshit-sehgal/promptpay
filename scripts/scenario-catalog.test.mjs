import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../scenarios/catalog.json' with { type: 'json' };

import { validateScenarioCatalog } from './scenario-catalog.mjs';

test('catalog enumerates every Appendix A scenario exactly once', () => {
  assert.deepEqual(validateScenarioCatalog(catalog), []);
  assert.equal(catalog.scenarios.length, 90);
});

test('catalog validation rejects omissions and duplicate IDs', () => {
  const invalid = {
    ...catalog,
    scenarios: catalog.scenarios.slice(0, 89).concat(catalog.scenarios[0]),
  };
  const errors = validateScenarioCatalog(invalid).join('\n');
  assert.match(errors, /scenario IDs must be unique/);
  assert.match(errors, /missing scenario 90/);
});
