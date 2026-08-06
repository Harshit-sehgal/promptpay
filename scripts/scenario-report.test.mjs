import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../scenarios/sandbox/terminal-claude-background-completion.json' with { type: 'json' };
import { buildScenarioReport, groupDuplicateReports, renderMarkdown } from './scenario-report.mjs';

const trace = manifest.expected.eventTypes.map((eventType) => ({ eventId: eventType, eventType }));
trace.push({
  eventId: 'placement',
  eventType: 'placement_claimed',
  placementType: 'completion_return',
});

test('report is deterministic, machine-readable, and excludes raw trace data', () => {
  const args = {
    manifest,
    trace,
    buildSha: 'abc123',
    environmentId: 'run-1',
    clientVersions: { cli: '1.0.0' },
  };
  const first = buildScenarioReport(args);
  const second = buildScenarioReport(args);
  assert.equal(first.status, 'passed');
  assert.equal(first.catalogId, 11);
  assert.equal(first.reportFingerprint, second.reportFingerprint);
  assert.equal('trace' in first, false);
  assert.match(renderMarkdown(first), /PASSED/);
});

test('identical reports group into one triage item', () => {
  const report = buildScenarioReport({ manifest, trace });
  const groups = groupDuplicateReports([
    report,
    { ...report },
    { ...report, reportFingerprint: 'other' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(
    groups.find((group) => group.fingerprint === report.reportFingerprint)?.occurrences,
    2,
  );
});

test('report carries safe issue-quality metadata without the raw trace', () => {
  const report = buildScenarioReport({
    manifest: {
      ...manifest,
      reporting: {
        deterministic: true,
        severity: 'high',
        reproductionConfidence: 1,
        evidenceArtifacts: ['report.json', 'invariants.json'],
      },
    },
    trace,
  });
  assert.equal(report.deterministic, true);
  assert.equal(report.severity, 'high');
  assert.equal(report.reproductionConfidence, 1);
  assert.deepEqual(report.evidenceArtifacts, ['report.json', 'invariants.json']);
  assert.equal('trace' in report, false);
});

test('repeated deterministic runs group despite different timestamps', () => {
  const first = buildScenarioReport({
    manifest,
    trace,
    startedAt: '2026-08-06T00:00:00.000Z',
    endedAt: '2026-08-06T00:00:01.000Z',
  });
  const second = buildScenarioReport({
    manifest,
    trace,
    startedAt: '2026-08-06T00:01:00.000Z',
    endedAt: '2026-08-06T00:01:01.000Z',
  });
  assert.equal(first.reportFingerprint, second.reportFingerprint);
});
