#!/usr/bin/env node
/** Build deterministic, privacy-safe scenario evidence reports. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { auditTrace, validateManifest } from './scenario-audit.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

export function buildScenarioReport({
  manifest,
  trace,
  buildSha = 'unknown',
  clientVersions = {},
  environmentId = 'unknown',
  startedAt,
  endedAt,
}) {
  const manifestErrors = validateManifest(manifest);
  const auditErrors = manifestErrors.length
    ? ['invalid scenario manifest']
    : auditTrace(manifest, trace);
  const eventCount = Array.isArray(trace)
    ? trace.length
    : Array.isArray(trace?.events)
      ? trace.events.length
      : 0;
  const report = {
    schemaVersion: 1,
    scenarioId: manifest.id,
    catalogId: manifest.catalogId,
    scenarioVersion: manifest.version,
    environment: manifest.environment,
    environmentId,
    buildSha,
    clientVersions: stable(clientVersions),
    deterministic: manifest.reporting?.deterministic === true,
    severity: manifest.reporting?.severity ?? 'medium',
    reproductionConfidence: manifest.reporting?.reproductionConfidence ?? 0,
    evidenceArtifacts: [...(manifest.reporting?.evidenceArtifacts ?? [])],
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
    eventCount,
    status: auditErrors.length === 0 ? 'passed' : 'failed',
    errors: [...manifestErrors, ...auditErrors],
  };
  // Timestamps describe the run but not its behavior. Excluding them from
  // the fingerprint is required for repeated deterministic runs to group
  // together in triage; the raw timestamps remain available as evidence.
  const fingerprintInput = { ...report, startedAt: null, endedAt: null };
  return { ...report, reportFingerprint: fingerprint(fingerprintInput) };
}

export function groupDuplicateReports(reports) {
  const groups = new Map();
  for (const report of reports) {
    const key = report.reportFingerprint ?? fingerprint(report);
    const group = groups.get(key) ?? { fingerprint: key, occurrences: 0, reports: [] };
    group.occurrences += 1;
    if (group.reports.length === 0) group.reports.push(report);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

export function renderMarkdown(report) {
  const lines = [
    `# Scenario report: ${report.scenarioId}`,
    '',
    `- Status: **${report.status.toUpperCase()}**`,
    `- Scenario version: ${report.scenarioVersion}`,
    `- Environment: ${report.environment} / ${report.environmentId}`,
    `- Build SHA: ${report.buildSha}`,
    `- Events audited: ${report.eventCount}`,
    `- Fingerprint: \`${report.reportFingerprint}\``,
  ];
  if (report.errors.length)
    lines.push('', '## Findings', '', ...report.errors.map((error) => `- ${error}`));
  return `${lines.join('\n')}\n`;
}

if (process.argv[1]?.endsWith('/scenario-report.mjs')) {
  const [manifestPath, tracePath, format = 'json'] = process.argv.slice(2);
  if (!manifestPath || !tracePath) {
    console.error(
      'usage: node scripts/scenario-report.mjs <manifest.json> <trace.json> [json|markdown]',
    );
    process.exitCode = 2;
  } else {
    const report = buildScenarioReport({
      manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
      trace: JSON.parse(fs.readFileSync(tracePath, 'utf8')),
      buildSha: process.env.GIT_SHA ?? 'unknown',
      environmentId: process.env.ATEVA_ENVIRONMENT_ID ?? 'unknown',
    });
    process.stdout.write(
      format === 'markdown' ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`,
    );
    if (!['json', 'markdown'].includes(format)) process.exitCode = 2;
  }
}
