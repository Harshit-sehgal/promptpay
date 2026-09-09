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

const REPORT_STATUSES = new Set(['passed', 'failed']);
const REPORT_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const REPORT_FAILURE_KINDS = new Set([
  'none',
  'deterministic_assertion',
  'invalid_manifest',
  'execution_error',
]);
const REPORT_KEYS = new Set([
  'schemaVersion',
  'scenarioId',
  'catalogId',
  'scenarioVersion',
  'environment',
  'environmentId',
  'buildSha',
  'clientVersions',
  'deterministic',
  'severity',
  'reproductionConfidence',
  'evidenceArtifacts',
  'startedAt',
  'endedAt',
  'eventCount',
  'status',
  'failureKind',
  'errors',
  'reportFingerprint',
]);

/**
 * Validate the redacted report contract before it enters triage.
 *
 * Scenario reports are machine inputs at CI and issue-automation boundaries;
 * a report that happens to contain `status: failed` must not be enough to
 * authorize automatic issue creation. This validator intentionally checks
 * structure and provenance metadata only. It never inspects or prints a raw
 * trace.
 */
export function validateScenarioReport(report) {
  const errors = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return ['report must be an object'];
  }

  for (const key of Object.keys(report)) {
    if (!REPORT_KEYS.has(key)) errors.push(`report contains unsupported field ${key}`);
  }
  if (report.schemaVersion !== 1) errors.push('report schemaVersion must be 1');
  if (typeof report.scenarioId !== 'string' || !/^[a-z0-9][a-z0-9-]+$/.test(report.scenarioId))
    errors.push('report scenarioId must be kebab-case');
  if (!Number.isInteger(report.catalogId) || report.catalogId < 1)
    errors.push('report catalogId must be a positive integer');
  if (!Number.isInteger(report.scenarioVersion) || report.scenarioVersion < 1)
    errors.push('report scenarioVersion must be a positive integer');
  if (!['sandbox', 'test'].includes(report.environment))
    errors.push('report environment must be sandbox or test');
  if (typeof report.environmentId !== 'string' || report.environmentId.length === 0)
    errors.push('report environmentId is required');
  if (typeof report.buildSha !== 'string' || report.buildSha.length === 0)
    errors.push('report buildSha is required');
  if (
    !report.clientVersions ||
    typeof report.clientVersions !== 'object' ||
    Array.isArray(report.clientVersions) ||
    Object.values(report.clientVersions).some((value) => typeof value !== 'string')
  )
    errors.push('report clientVersions must be a string map');
  if (typeof report.deterministic !== 'boolean')
    errors.push('report deterministic must be boolean');
  if (typeof report.severity !== 'string' || !REPORT_SEVERITIES.has(report.severity))
    errors.push('report severity is invalid');
  if (
    typeof report.reproductionConfidence !== 'number' ||
    !Number.isFinite(report.reproductionConfidence) ||
    report.reproductionConfidence < 0 ||
    report.reproductionConfidence > 1
  )
    errors.push('report reproductionConfidence must be between 0 and 1');
  if (!REPORT_FAILURE_KINDS.has(report.failureKind)) errors.push('report failureKind is invalid');
  if (!REPORT_STATUSES.has(report.status)) errors.push('report status is invalid');
  if (!Number.isInteger(report.eventCount) || report.eventCount < 0)
    errors.push('report eventCount must be a non-negative integer');
  if (!Array.isArray(report.errors) || report.errors.some((error) => typeof error !== 'string'))
    errors.push('report errors must be an array of strings');
  if (!Array.isArray(report.evidenceArtifacts)) {
    errors.push('report evidenceArtifacts must be an array');
  } else {
    for (const artifact of report.evidenceArtifacts) {
      if (
        typeof artifact !== 'string' ||
        artifact.length === 0 ||
        artifact.includes('\0') ||
        artifact.startsWith('/') ||
        artifact.startsWith('\\') ||
        artifact.split(/[\\/]/).includes('..')
      ) {
        errors.push('report evidenceArtifacts must contain safe relative paths');
        break;
      }
    }
  }
  const hasValidFingerprint = /^[a-f0-9]{64}$/.test(report.reportFingerprint ?? '');
  if (!hasValidFingerprint) errors.push('report reportFingerprint must be a SHA-256 hex digest');
  else {
    const { reportFingerprint, ...fingerprintInput } = report;
    const expectedFingerprint = fingerprint({
      ...fingerprintInput,
      startedAt: null,
      endedAt: null,
    });
    if (reportFingerprint !== expectedFingerprint)
      errors.push('report reportFingerprint does not match report contents');
  }
  if (report.status === 'passed' && report.errors?.length > 0)
    errors.push('passed report cannot contain errors');
  if (report.status === 'passed' && report.failureKind !== 'none')
    errors.push('passed report must have failureKind none');
  if (report.status === 'failed' && report.errors?.length === 0)
    errors.push('failed report must contain at least one error');
  if (report.failureKind === 'none' && report.status === 'failed')
    errors.push('failed report must identify a failure kind');
  if (report.failureKind !== 'none' && report.status !== 'failed')
    errors.push('reports with a failure kind must be failed');

  return errors;
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
    failureKind:
      auditErrors.length === 0
        ? 'none'
        : manifestErrors.length > 0
          ? 'invalid_manifest'
          : 'deterministic_assertion',
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
    // Never trust a producer-supplied fingerprint for grouping. A forged
    // digest could merge an unrelated failure into an existing automatic-issue
    // group before triage has a chance to reject the report. Recompute from
    // the report body and keep timestamps out of the behavior identity.
    const { reportFingerprint: _reportFingerprint, ...fingerprintInput } = report ?? {};
    const key = fingerprint({ ...fingerprintInput, startedAt: null, endedAt: null });
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
