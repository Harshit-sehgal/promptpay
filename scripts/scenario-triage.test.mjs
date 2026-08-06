import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScenarioReport } from './scenario-report.mjs';
import { buildTriageQueue } from './scenario-triage.mjs';

function failedReport(id, errors) {
  return buildScenarioReport({
    manifest: {
      id,
      version: 1,
      environment: 'sandbox',
      expected: {
        eventTypes: ['expected'],
        placementTypes: [],
        financialMode: 'sandbox',
        hasCashValue: false,
      },
      forbidden: { eventTypes: [], fields: [] },
      tolerances: {
        duplicateCanonicalEvents: 0,
        missingExpectedEventTypes: 0,
        forbiddenMatches: 0,
      },
      actions: ['test'],
      persona: 'test',
      seed: 'seed',
      reporting: {
        deterministic: true,
        severity: 'high',
        reproductionConfidence: 1,
        evidenceArtifacts: ['failure.json'],
      },
    },
    trace: [{ eventId: 'x', eventType: 'unexpected' }],
  });
}

test('triage groups duplicate failures and retains no trace data', () => {
  const first = failedReport('scenario-a', ['failure']);
  const queue = buildTriageQueue([first, { ...first }]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].occurrences, 2);
  assert.equal(queue[0].status, 'open');
  assert.equal(queue[0].issueEligibility, 'automatic');
  assert.equal(queue[0].evidenceArtifacts[0], 'failure.json');
  assert.equal('trace' in queue[0], false);
});

test('triage preserves acknowledgement and resolved history', () => {
  const current = failedReport('scenario-a', ['failure']);
  const old = {
    fingerprint: current.reportFingerprint,
    scenarioId: 'scenario-a',
    status: 'acknowledged',
    occurrences: 1,
    errors: ['old'],
  };
  const resolved = {
    fingerprint: 'resolved-fingerprint',
    scenarioId: 'old',
    status: 'resolved',
    occurrences: 4,
    errors: ['fixed'],
  };
  const queue = buildTriageQueue([current], [old, resolved]);
  assert.equal(queue.find((item) => item.scenarioId === 'scenario-a')?.status, 'acknowledged');
  assert.equal(queue.find((item) => item.scenarioId === 'old')?.status, 'resolved');
});
