import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearAgentTelemetry,
  enqueueAgentEvent,
  getSpoolPaths,
  readSpoolStatus,
} from '../../apps/cli/dist/lib/agent-spool.js';
import { clearCredentials } from '../../apps/cli/dist/lib/credentials.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-scenario-logout-'));
const credentialFile = path.join(directory, 'credentials.json');
const paths = getSpoolPaths(path.join(directory, 'spool'));
const installationId = 'logout-queued-installation-v1';
const deviceId = '00000000-0000-4000-8000-000000000005';

try {
  fs.mkdirSync(path.dirname(credentialFile), { recursive: true });
  fs.writeFileSync(credentialFile, JSON.stringify({ userId: 'logout-user', accessToken: 'token' }));
  enqueueAgentEvent({
    installationId,
    deviceId,
    event: {
      schemaVersion: 1,
      eventId: '00000000-0000-4000-8000-000000000505',
      idempotencyKey: 'logout-queued-event',
      environmentKind: 'sandbox',
      environmentId: 'scenario-logout',
      installationId,
      deviceId,
      provider: 'generic_wrapper',
      integrationMode: 'wrapper',
      eventType: 'session.started',
      sourceType: 'inferred',
      confidence: 0.5,
      occurredAt: '2026-08-06T00:00:00.000Z',
      correlationId: 'logout-correlation',
      adapterVersion: 'scenario',
      clientVersion: 'scenario',
      metadata: {},
    },
  }, paths);
  if (readSpoolStatus(paths).queuedEvents !== 1) throw new Error('logout fixture did not queue telemetry');
  await clearCredentials({ credentialFile, spoolPaths: paths, clearKeychain: false });
  const status = readSpoolStatus(paths);
  if (fs.existsSync(credentialFile) || status.queuedEvents !== 0 || status.inFlightEvents !== 0)
    throw new Error('logout left credentials or queued telemetry behind');
  process.stdout.write(`${JSON.stringify([{
    eventId: 'scenario-logout-completed',
    eventType: 'identity.logout.completed',
    mode: 'sandbox',
    financialMode: 'sandbox',
    hasCashValue: false,
  }])}\n`);
} finally {
  clearAgentTelemetry(paths);
  fs.rmSync(directory, { recursive: true, force: true });
}
