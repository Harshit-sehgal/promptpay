#!/usr/bin/env node
/** Report executable scenario-manifest coverage against the Appendix A catalog. */
import fs from 'node:fs';
import path from 'node:path';

import catalog from '../scenarios/catalog.json' with { type: 'json' };

export function buildScenarioCoverage(manifests) {
  const executed = new Set(
    manifests
      .map((manifest) => manifest.catalogId)
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= catalog.scenarios.length),
  );
  const missing = catalog.scenarios.filter((scenario) => !executed.has(scenario.id));
  const byCategory = Object.fromEntries(
    [...new Set(catalog.scenarios.map((scenario) => scenario.category))].map((category) => {
      const all = catalog.scenarios.filter((scenario) => scenario.category === category);
      const covered = all.filter((scenario) => executed.has(scenario.id));
      return [category, { covered: covered.length, total: all.length }];
    }),
  );
  return {
    catalogTotal: catalog.scenarios.length,
    covered: executed.size,
    coverageRate: Number((executed.size / catalog.scenarios.length).toFixed(4)),
    byCategory,
    missing: missing.map(({ id, category, title }) => ({ id, category, title })),
  };
}

if (process.argv[1]?.endsWith('/scenario-coverage.mjs')) {
  const directory = process.argv[2] ?? 'scenarios/sandbox';
  const manifests = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
  process.stdout.write(`${JSON.stringify(buildScenarioCoverage(manifests), null, 2)}\n`);
}
