import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../scenarios/sandbox/terminal-claude-background-completion.json' with { type: 'json' };
import { auditTrace, validateManifest } from './scenario-audit.mjs';

test('sandbox manifest declares non-cash truth labels', () => {
  assert.deepEqual(validateManifest(manifest), []);
});

test('auditor rejects duplicate or forbidden traces', () => {
  const trace = manifest.expected.eventTypes.map((eventType) => ({
    eventId: eventType,
    eventType,
  }));
  trace.push({ eventId: 'placement', eventType: 'placement_claimed' });
  assert.match(auditTrace(manifest, trace).join('\n'), /missing expected placements/);
  trace.push({ eventId: 'bad', eventType: 'raw_prompt', prompt: 'secret' });
  trace.push({ eventId: 'bad', eventType: 'raw_prompt', prompt: 'secret' });
  assert.match(auditTrace(manifest, trace).join('\n'), /forbidden field prompt/);
  assert.match(auditTrace(manifest, trace).join('\n'), /duplicate canonical events/);
});

test('auditor accepts a complete sanitized trace', () => {
  const trace = manifest.expected.eventTypes.map((eventType) => ({
    eventId: eventType,
    eventType,
  }));
  trace.push({
    eventId: 'placement',
    eventType: 'placement_claimed',
    placementType: 'completion_return',
    mode: 'sandbox',
    hasCashValue: false,
  });
  assert.deepEqual(auditTrace(manifest, trace), []);
});

test('auditor rejects a trace that claims production or cash value', () => {
  const trace = manifest.expected.eventTypes.map((eventType) => ({
    eventId: eventType,
    eventType,
  }));
  trace.push({
    eventId: 'placement',
    eventType: 'placement.claimed',
    placementType: 'completion_return',
    mode: 'production',
    hasCashValue: true,
  });
  const errors = auditTrace(manifest, trace).join('\n');
  assert.match(errors, /unsafe financial mode production/);
  assert.match(errors, /cash-value truth label must be false/);
});

test('auditor requires canonical IDs and rejects prototype-pollution keys', () => {
  const trace = manifest.expected.eventTypes.map((eventType) => ({ eventType }));
  trace[0].metadata = { ['__proto__']: { polluted: true } };
  const errors = auditTrace(manifest, trace).join('\n');
  assert.match(errors, /event missing canonical eventId/);
  assert.match(errors, /forbidden structure key __proto__/);
});

test('auditor rejects an event without a canonical event type', () => {
  const trace = manifest.expected.eventTypes.map((eventType) => ({
    eventId: eventType,
    eventType,
  }));
  delete trace[0].eventType;
  const errors = auditTrace(manifest, trace).join('\n');
  assert.match(errors, /event missing canonical eventType/);
});
