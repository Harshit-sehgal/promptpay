import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isAgentEventTimestampBounded } from '../../packages/agent-protocol/dist/index.js';
import {
  clearAgentEventSpool,
  enqueueAgentEvent,
  getSpoolPaths,
  readSpoolStatus,
} from '../../apps/cli/dist/lib/agent-spool.js';

const mode = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-scenario-reliability-'));
const paths = getSpoolPaths(directory);
const installationId = 'reliability-boundary-installation-v1';
const deviceId = '00000000-0000-4000-8000-000000000064';

function spoolEvent(eventId) {
  return {
    schemaVersion: 1,
    eventId,
    idempotencyKey: `reliability-${eventId}`,
    environmentKind: 'sandbox',
    environmentId: 'scenario-reliability',
    installationId,
    deviceId,
    provider: 'generic_wrapper',
    integrationMode: 'wrapper',
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.5,
    occurredAt: '2026-08-06T00:00:00.000Z',
    correlationId: `correlation-${eventId}`,
    adapterVersion: 'scenario',
    clientVersion: 'scenario',
    metadata: {},
  };
}

try {
  if (mode === 'queue-full') {
    fs.mkdirSync(directory, { recursive: true });
    const seededRecords = Array.from({ length: 10_000 }, (_, index) => ({
      queuedAt: '2026-08-06T00:00:00.000Z',
      installationId,
      deviceId,
      event: spoolEvent(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    }));
    // Seed valid durable records in one isolated write; the behavior under
    // test is the real parser/capacity guard, not lock throughput.
    fs.writeFileSync(paths.queueFile, `${seededRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);
    let rejected = false;
    try {
      enqueueAgentEvent({ installationId, deviceId, event: spoolEvent(randomUUID()) }, paths);
    } catch (error) {
      rejected = /queue is full/.test(String(error?.message ?? error));
    }
    const status = readSpoolStatus(paths);
    if (!rejected || status.queuedEvents !== 10_000)
      throw new Error('local spool did not fail closed at its event-count limit');
    process.stdout.write(`${JSON.stringify([{
      eventId: 'scenario-queue-full',
      eventType: 'queue.backpressure',
      mode: 'sandbox',
      financialMode: 'sandbox',
      hasCashValue: false,
      metadata: { queuedEvents: status.queuedEvents, rejected: true },
    }])}\n`);
  } else if (mode === 'clock-skew') {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const cases = [
      ['recent', '2026-08-06T11:59:00.000Z', true],
      ['too_old', '2026-07-29T11:59:59.999Z', false],
      ['too_future', '2026-08-06T12:06:00.000Z', false],
      ['malformed', 'not-a-date', false],
    ];
    for (const [, timestamp, expected] of cases) {
      if (isAgentEventTimestampBounded(timestamp, now) !== expected)
        throw new Error(`timestamp bound mismatch for ${timestamp}`);
    }
    process.stdout.write(`${JSON.stringify([{
      eventId: 'scenario-clock-skew-rejected',
      eventType: 'event.rejected',
      mode: 'sandbox',
      financialMode: 'sandbox',
      hasCashValue: false,
      metadata: { staleAndFutureEventsRejected: true },
    }])}\n`);
  } else throw new Error(`unknown reliability mode: ${mode}`);
} finally {
  clearAgentEventSpool(paths);
  fs.rmSync(directory, { recursive: true, force: true });
}
