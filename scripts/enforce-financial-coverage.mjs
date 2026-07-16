#!/usr/bin/env node
/**
 * Per-file branch-coverage enforcement for critical financial modules.
 *
 * The repo-wide `vitest` coverage threshold is a blunt global floor (50%
 * branch). Financial correctness demands a tighter, per-module floor so a
 * regression in a money path cannot hide behind the average. This script reads
 * the v8 `json-summary` coverage report and asserts each listed module meets
 * its configured branch floor.
 *
 * Floors are set just below the CURRENTLY MEASURED coverage so the gate passes
 * today and locks progress against regression. The product target is 90% branch
 * on every critical financial module; raise these floors as branch tests are
 * added until each reaches 90.
 *
 * Usage (from repo root, after `pnpm --filter waitlayer-api test:cov`):
 *   node scripts/enforce-financial-coverage.mjs
 *
 * Env:
 *   COVERAGE_SUMMARY  path to coverage-summary.json
 *                     (default: apps/api/coverage/coverage-summary.json)
 *   FINANCIAL_COVERAGE_FLOORS  optional JSON override mapping file -> branch pct
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();
const summaryPath =
  process.env.COVERAGE_SUMMARY ?? join(repoRoot, 'apps', 'api', 'coverage', 'coverage-summary.json');

// File path (relative to apps/api/src) -> minimum branch coverage %.
// Target: 90% for every entry. Floors are set ~2 points below the coverage
// measured on 2026-07-16 so the gate passes today and locks progress against
// regression without flaking on <2% measurement variance between runs. Raise
// these floors toward 90 as branch tests are added.
const DEFAULT_FLOORS = {
  'payout/payout-request.trait.ts': 58,
  'payout/payout-method.trait.ts': 64,
  'payout/payout-summary.trait.ts': 53,
  'payout/payout-cron.service.ts': 74,
  'payout/stripe-webhook.controller.ts': 46,
  'ledger/ledger-math.trait.ts': 83,
  'ledger/ledger-earnings.trait.ts': 72,
  'ledger/ledger-balance.trait.ts': 64,
  'extension/extension-ad.trait.ts': 62,
  'extension/extension-wait.trait.ts': 70,
  'fraud/fraud.service.ts': 63,
  'advertiser/advertiser-campaign.trait.ts': 48,
  'advertiser/advertiser-dashboard.trait.ts': 65,
  'payout/providers/wise.provider.ts': 73,
  'payout/providers/paypal-payouts.provider.ts': 63,
  'payout/providers/stripe.provider.ts': 33,
};

let floors = DEFAULT_FLOORS;
if (process.env.FINANCIAL_COVERAGE_FLOORS) {
  try {
    floors = JSON.parse(process.env.FINANCIAL_COVERAGE_FLOORS);
  } catch {
    console.error('FINANCIAL_COVERAGE_FLOORS is not valid JSON');
    process.exit(2);
  }
}

const TARGET = 90;

function loadSummary() {
  let raw;
  try {
    raw = readFileSync(summaryPath, 'utf8');
  } catch {
    console.error(`Coverage summary not found at ${summaryPath}.
Run \`pnpm --filter waitlayer-api test:cov\` first (it emits json-summary).`);
    process.exit(2);
  }
  return JSON.parse(raw);
}

function main() {
  const summary = loadSummary();
  const failures = [];
  let belowTarget = [];

  for (const [relPath, floor] of Object.entries(floors)) {
    // v8 json-summary keys are absolute paths. Match by suffix.
    const key = Object.keys(summary).find((k) => k.endsWith('/' + relPath));
    if (!key) {
      failures.push(`${relPath}: not found in coverage report (excluded? renamed?)`);
      continue;
    }
    const branchPct = summary[key].branches?.pct ?? 0;
    if (branchPct < floor) {
      failures.push(`${relPath}: branch ${branchPct}% < floor ${floor}%`);
    }
    if (branchPct < TARGET) {
      belowTarget.push(`${relPath} (${branchPct}%)`);
    }
  }

  if (failures.length > 0) {
    console.error('Financial coverage floors NOT met:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }

  console.log('Financial coverage floors met.');
  if (belowTarget.length > 0) {
    console.log(`\nBranch coverage below the 90% target (raise floors as tests are added):`);
    for (const entry of belowTarget) console.log(`  - ${entry}`);
  } else {
    console.log('All critical financial modules at or above the 90% branch target.');
  }
}

main();