#!/usr/bin/env node
/** Validate the complete deterministic scenario catalog from the blueprint. */
import fs from 'node:fs';

const EXPECTED_COUNT = 90;
const REQUIRED_CATEGORIES = new Set([
  'identity_consent',
  'terminal_native',
  'vscode',
  'concurrency',
  'advertising',
  'sandbox_finance',
  'reliability',
  'privacy',
  'adversarial',
]);

export function validateScenarioCatalog(catalog) {
  const errors = [];
  const scenarios = Array.isArray(catalog?.scenarios) ? catalog.scenarios : [];
  if (catalog?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (scenarios.length !== EXPECTED_COUNT)
    errors.push(`expected ${EXPECTED_COUNT} scenarios, found ${scenarios.length}`);
  const ids = scenarios.map((scenario) => scenario?.id);
  if (new Set(ids).size !== ids.length) errors.push('scenario IDs must be unique');
  for (let id = 1; id <= EXPECTED_COUNT; id += 1) {
    if (!ids.includes(id)) errors.push(`missing scenario ${id}`);
  }
  const categories = new Set(scenarios.map((scenario) => scenario?.category));
  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) errors.push(`missing category ${category}`);
  }
  for (const scenario of scenarios) {
    if (!Number.isInteger(scenario?.id) || !scenario?.category || !scenario?.title)
      errors.push(`invalid scenario entry ${JSON.stringify(scenario)}`);
  }
  return errors;
}

export const SCENARIO_CATALOG_PATH = 'scenarios/catalog.json';

if (process.argv[1]?.endsWith('/scenario-catalog.mjs')) {
  const catalog = JSON.parse(fs.readFileSync(process.argv[2] ?? SCENARIO_CATALOG_PATH, 'utf8'));
  const errors = validateScenarioCatalog(catalog);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Scenario catalog valid: ${catalog.scenarios.length} entries`);
  }
}
