#!/usr/bin/env node
/** Run one deterministic scenario repeatedly and emit sanitized performance evidence. */
import { performance } from 'node:perf_hooks';

import { runScenario } from './scenario-runner.mjs';
import { buildScenarioReport } from './scenario-report.mjs';

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
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
  return {
    scenarioId: reports[0]?.scenarioId,
    catalogId: reports[0]?.catalogId,
    repetitions,
    allPassed: reports.every((report) => report.status === 'passed'),
    deterministic: fingerprints.length === 1,
    uniqueFingerprints: fingerprints.length,
    behaviorFingerprint: fingerprints[0] ?? null,
    durationMs: durationsMs.map((duration) => Number(duration.toFixed(3))),
    p50Ms: percentile(durationsMs, 0.5),
    p95Ms: percentile(durationsMs, 0.95),
  };
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
