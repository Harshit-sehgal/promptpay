#!/usr/bin/env node
// Disposable deterministic fixture process. It emits only protocol-shaped,
// privacy-safe events; no provider prompt, output, path, or command is used.
const eventTypes = [
  'session.started',
  'task.created',
  'task.completed',
  'user.backgrounded',
  'user.returned',
  'placement.claimed',
];
const events = eventTypes.map((eventType) => ({
  eventId: `fixture-${eventType}`,
  eventType,
  ...(eventType === 'placement.claimed'
    ? { placementType: 'completion_return', mode: 'sandbox', hasCashValue: false }
    : {}),
}));
process.stdout.write(`${JSON.stringify(events)}\n`);
