#!/usr/bin/env node
/** Run one deterministic scenario repeatedly and emit sanitized performance evidence. */
import { performance } from 'node:perf_hooks';

import { runScenario } from './scenario-runner.mjs';
import { buildScenarioReport } from './scenario-report.mjs';

export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new TypeError('percentile values must be a non-negative finite number array');
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1)
    throw new RangeError('percentile fraction must be greater than 0 and at most 1');
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

const PERCENTILES = { p50Ms: 0.5, p95Ms: 0.95, p99Ms: 0.99 };
const PERCENTILE_FIELDS = Object.keys(PERCENTILES);

export function validateRepeatEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    return ['repeat evidence must be an object'];

  if (!Number.isInteger(evidence.repetitions) || evidence.repetitions < 2)
    errors.push('repetitions must be an integer of at least 2');
  if (
    !Array.isArray(evidence.durationMs) ||
    evidence.durationMs.some((duration) => !Number.isFinite(duration) || duration < 0)
  )
    errors.push('durationMs must be an array of non-negative finite numbers');
  else if (evidence.durationMs.length !== evidence.repetitions)
    errors.push('durationMs length must equal repetitions');

  for (const field of PERCENTILE_FIELDS) {
    if (!Number.isFinite(evidence[field]) || evidence[field] < 0)
      errors.push(`${field} must be a non-negative finite number`);
  }
  if (PERCENTILE_FIELDS.every((field) => Number.isFinite(evidence[field]))) {
    for (let index = 1; index < PERCENTILE_FIELDS.length; index += 1) {
      const previous = evidence[PERCENTILE_FIELDS[index - 1]];
      const current = evidence[PERCENTILE_FIELDS[index]];
      if (current < previous) {
        errors.push(`${PERCENTILE_FIELDS[index]} must be at least ${PERCENTILE_FIELDS[index - 1]}`);
      }
    }
  }
  const hasValidDurations =
    Array.isArray(evidence.durationMs) &&
    evidence.durationMs.length > 0 &&
    evidence.durationMs.every((duration) => Number.isFinite(duration) && duration >= 0);
  if (hasValidDurations) {
    for (const [field, fraction] of Object.entries(PERCENTILES)) {
      const expected = percentile(evidence.durationMs, fraction);
      if (Number.isFinite(evidence[field]) && evidence[field] !== expected)
        errors.push(`${field} must equal the percentile calculated from durationMs`);
    }
    const maximum = Math.max(...evidence.durationMs);
    if (Number.isFinite(evidence.p99Ms) && evidence.p99Ms > maximum)
      errors.push('p99Ms must not exceed the maximum recorded duration');
  }

  return errors;
}

export async function repeatScenario(manifestPath, repetitions = 3) {
  if (!Number.isInteger(repetitions) || repetitions < 2 || repetitions > 30)
    throw new Error('repetitions must be an integer between 2 and 30');
  const durationsMs = [];
  const reports = [];
  for (let index = 0; index < repetitions; index += 1) {
    const started = performance.now();
    const result = await runScenario(manifestPath);
    durationsMs.push(performance.now() - started);
    reports.push(buildScenarioReport(result));
  }
  const fingerprints = [...new Set(reports.map((report) => report.reportFingerprint))];
  const durationMs = durationsMs.map((duration) => Number(duration.toFixed(3)));
  const evidence = {
    scenarioId: reports[0]?.scenarioId,
    catalogId: reports[0]?.catalogId,
    repetitions,
    allPassed: reports.every((report) => report.status === 'passed'),
    deterministic: fingerprints.length === 1,
    uniqueFingerprints: fingerprints.length,
    behaviorFingerprint: fingerprints[0] ?? null,
    durationMs,
    p50Ms: percentile(durationMs, 0.5),
    p95Ms: percentile(durationMs, 0.95),
    p99Ms: percentile(durationMs, 0.99),
  };
  const validationErrors = validateRepeatEvidence(evidence);
  if (validationErrors.length)
    throw new Error(`invalid repeat evidence: ${validationErrors.join('; ')}`);
  return evidence;
}

if (process.argv[1]?.endsWith('/scenario-repeat.mjs')) {
  const offset = process.argv[2] === '--' ? 1 : 0;
  const manifestPath = process.argv[2 + offset];
  const repetitions = Number(process.argv[3 + offset] ?? 3);
  if (!manifestPath) {
    console.error('usage: node scripts/scenario-repeat.mjs <manifest.json> [repetitions]');
    process.exitCode = 2;
  } else {
    repeatScenario(manifestPath, repetitions)
      .then((evidence) => process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
