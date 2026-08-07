import assert from 'node:assert/strict';
import test from 'node:test';

import { firedCriticalAlertEvents } from './prometheus-alerts.mjs';

const critical = ['ledger_discrepancy', 'audit_dead_letter', 'payout_paid_without_provider_tx'];

test('detects positive critical counters in actual Prometheus label syntax', () => {
  const text = [
    '# TYPE alert counter',
    'alert{event="ledger_discrepancy",instance="api-1"} 1',
    'alert{instance="api-2",event="audit_dead_letter"} 2',
    'alert{event="payout_paid_without_provider_tx",instance="api-1"} 0',
  ].join('\n');

  assert.deepEqual(firedCriticalAlertEvents(text, critical), [
    'ledger_discrepancy',
    'audit_dead_letter',
  ]);
});

test('does not match comments, similarly named metrics, or zero counters', () => {
  const text = [
    '# alert{event="ledger_discrepancy",instance="api"} 9',
    'alert_total{event="ledger_discrepancy",instance="api"} 9',
    'alert{event="ledger_discrepancy",instance="api"} 0',
    'alert{event="informational",instance="api"} 5',
  ].join('\n');

  assert.deepEqual(firedCriticalAlertEvents(text, critical), []);
});

test('detects a positive sample when another replica reports zero', () => {
  const text = [
    'alert{event="ledger_discrepancy",instance="api-1"} 0',
    'alert{event="ledger_discrepancy",instance="api-2"} 1e0',
  ].join('\n');

  assert.deepEqual(firedCriticalAlertEvents(text, critical), ['ledger_discrepancy']);
});
