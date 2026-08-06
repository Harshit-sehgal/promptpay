#!/usr/bin/env node
/** Build a deterministic, privacy-safe triage queue from scenario reports. */
import fs from 'node:fs';

import { groupDuplicateReports } from './scenario-report.mjs';

const STATES = new Set(['open', 'acknowledged', 'resolved']);

export function buildTriageQueue(reports, previous = []) {
  const failed = reports.filter((report) => report?.status === 'failed');
  const groups = groupDuplicateReports(failed);
  const prior = new Map(
    previous
      .filter((item) => item && typeof item.fingerprint === 'string')
      .map((item) => [item.fingerprint, item]),
  );
  const current = groups.map((group) => {
    const old = prior.get(group.fingerprint);
    const status = STATES.has(old?.status) ? old.status : 'open';
    const report = group.reports[0];
    return {
      fingerprint: group.fingerprint,
      scenarioId: report.scenarioId,
      status,
      occurrences: group.occurrences,
      severity: report.severity ?? 'medium',
      reproductionConfidence: report.reproductionConfidence ?? 0,
      evidenceArtifacts: [...(report.evidenceArtifacts ?? [])],
      issueEligibility:
        report.status === 'failed' &&
        report.deterministic === true &&
        report.reproductionConfidence === 1 &&
        ['critical', 'high'].includes(report.severity)
          ? 'automatic'
          : 'human_review',
      errors: [...report.errors],
    };
  });
  const currentFingerprints = new Set(current.map((item) => item.fingerprint));
  const resolvedHistory = previous
    .filter((item) => item.status === 'resolved' && !currentFingerprints.has(item.fingerprint))
    .map((item) => ({
      fingerprint: item.fingerprint,
      scenarioId: item.scenarioId,
      status: 'resolved',
      occurrences: item.occurrences,
      errors: [...(item.errors ?? [])],
    }));
  return [...current, ...resolvedHistory].sort((a, b) =>
    a.fingerprint.localeCompare(b.fingerprint),
  );
}

if (process.argv[1]?.endsWith('/scenario-triage.mjs')) {
  const reportsPath = process.argv[2];
  const previousPath = process.argv[3];
  if (!reportsPath) {
    console.error('usage: node scripts/scenario-triage.mjs <reports.json> [previous-queue.json]');
    process.exitCode = 2;
  } else {
    const reports = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
    const previous = previousPath ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : [];
    process.stdout.write(`${JSON.stringify(buildTriageQueue(reports, previous), null, 2)}\n`);
  }
}
