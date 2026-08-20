import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearAgentEventSpool,
  enqueueAgentEvent,
  getSpoolPaths,
  readSpoolStatus,
} from '../../apps/cli/dist/lib/agent-spool.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ateva-scenario-queue-'));
try {
  const paths = getSpoolPaths(directory);
  const installationId = 'queue-delete-installation-v1';
  const deviceId = '00000000-0000-4000-8000-000000000080';
  enqueueAgentEvent(
    {
      installationId,
      deviceId,
      event: {
        schemaVersion: 1,
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        environmentKind: 'sandbox',
        environmentId: 'scenario-queue-delete',
        installationId,
        deviceId,
        provider: 'generic_wrapper',
        integrationMode: 'wrapper',
        eventType: 'session.started',
        sourceType: 'inferred',
        confidence: 0.5,
        occurredAt: '2026-08-06T00:00:00.000Z',
        correlationId: randomUUID(),
        adapterVersion: 'scenario',
        clientVersion: 'scenario',
        metadata: {},
      },
    },
    paths,
  );
  if (readSpoolStatus(paths).queuedEvents !== 1) throw new Error('queue fixture did not enqueue');
  clearAgentEventSpool(paths);
  const status = readSpoolStatus(paths);
  if (status.queuedEvents !== 0 || status.inFlightEvents !== 0 || status.quarantinedEvents !== 0)
    throw new Error('local queue deletion left durable records behind');
  process.stdout.write('[]\n');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
