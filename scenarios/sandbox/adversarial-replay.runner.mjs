#!/usr/bin/env node
// A deliberately hostile fixture: replaying the same canonical event ID must
// fail the independent auditor without exposing any private payload.
const trace = [
  { eventId: 'session-1', eventType: 'session.started' },
  {
    eventId: 'placement-1',
    eventType: 'placement.claimed',
    placementType: 'foreground_wait',
    mode: 'sandbox',
    hasCashValue: false,
  },
  {
    eventId: 'placement-1',
    eventType: 'placement.claimed',
    placementType: 'foreground_wait',
    mode: 'sandbox',
    hasCashValue: false,
  },
];
process.stdout.write(`${JSON.stringify(trace)}\n`);
