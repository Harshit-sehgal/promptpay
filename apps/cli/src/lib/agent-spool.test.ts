import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { agentLifecycleEventSchema, AgentLifecycleEventV1 } from '@waitlayer/agent-protocol';

import {
  claimAgentEventBatch,
  clearAgentEventSpool,
  clearAgentTelemetry,
  completeAgentEventBatch,
  enqueueAgentEvent,
  flushAgentEventSpool,
  getSpoolPaths,
  readSpoolStatus,
} from './agent-spool';

const directories: string[] = [];
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = 'installation-123456789';

function makeEvent(overrides: Partial<AgentLifecycleEventV1> = {}): AgentLifecycleEventV1 {
  return agentLifecycleEventSchema.parse({
    schemaVersion: 1,
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    environmentKind: 'test',
    environmentId: 'test-run',
    installationId: INSTALLATION_ID,
    deviceId: DEVICE_ID,
    provider: 'generic_wrapper',
    integrationMode: 'wrapper',
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.5,
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    adapterVersion: 'test',
    clientVersion: 'test',
    metadata: {},
    ...overrides,
  });
}

function paths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-spool-'));
  directories.push(directory);
  return getSpoolPaths(directory);
}

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('agent spool', () => {
  it('validates privacy-safe events and reports queued health', () => {
    const spool = paths();
    const event = makeEvent();
    enqueueAgentEvent({ installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event }, spool);
    enqueueAgentEvent({ installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event }, spool);

    expect(readSpoolStatus(spool)).toMatchObject({
      queuedEvents: 1,
      inFlightEvents: 0,
      quarantinedEvents: 0,
    });
  });

  it('rejects mismatched outer and event identities before persistence', () => {
    const spool = paths();
    expect(() =>
      enqueueAgentEvent({
        installationId: 'different-installation',
        deviceId: DEVICE_ID,
        event: makeEvent(),
      }),
    ).toThrow('different installation');
    expect(readSpoolStatus(spool).queuedEvents).toBe(0);
  });

  it('rejects forbidden data before it can be persisted', () => {
    const spool = paths();
    expect(() =>
      enqueueAgentEvent({
        installationId: INSTALLATION_ID,
        deviceId: DEVICE_ID,
        event: makeEvent({ metadata: { ...({ command: 'npm test' } as never) } as never }),
      }),
    ).toThrow();
    expect(readSpoolStatus(spool).queuedEvents).toBe(0);
  });

  it('claims one installation/device batch and replays an unacknowledged claim', () => {
    const spool = paths();
    const first = makeEvent();
    const second = makeEvent();
    enqueueAgentEvent(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: first },
      spool,
    );
    enqueueAgentEvent(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: second },
      spool,
    );

    const claimed = claimAgentEventBatch(spool);
    expect(claimed).toHaveLength(2);
    expect(readSpoolStatus(spool)).toMatchObject({ queuedEvents: 0, inFlightEvents: 2 });
    expect(claimAgentEventBatch(spool)).toHaveLength(2);
  });

  it('acknowledges accepted/duplicate events and quarantines explicit rejections', () => {
    const spool = paths();
    const accepted = makeEvent();
    const rejected = makeEvent();
    enqueueAgentEvent(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: accepted },
      spool,
    );
    enqueueAgentEvent(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: rejected },
      spool,
    );
    claimAgentEventBatch(spool);

    completeAgentEventBatch(
      {
        accepted: [accepted.eventId],
        duplicates: [],
        rejected: [{ eventId: rejected.eventId, reason: 'invalid' }],
      },
      spool,
    );

    expect(readSpoolStatus(spool)).toMatchObject({
      queuedEvents: 0,
      inFlightEvents: 0,
      quarantinedEvents: 1,
    });
  });

  it('quarantines malformed in-flight records instead of silently dropping them', () => {
    const spool = paths();
    fs.writeFileSync(spool.inFlightFile, '{bad-json}\n', { mode: 0o600 });

    expect(readSpoolStatus(spool)).toMatchObject({
      queuedEvents: 0,
      inFlightEvents: 0,
      quarantinedEvents: 1,
    });
    expect(fs.existsSync(spool.inFlightFile)).toBe(false);
    fs.writeFileSync(spool.inFlightFile, '{bad-json}\n', { mode: 0o600 });
    expect(claimAgentEventBatch(spool)).toEqual([]);
    expect(readSpoolStatus(spool).quarantinedEvents).toBe(2);
  });

  it('keeps the claim for an upload failure so a later flush can retry', async () => {
    const spool = paths();
    enqueueAgentEvent(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: makeEvent() },
      spool,
    );
    await expect(
      flushAgentEventSpool(async () => {
        throw new Error('offline');
      }, spool),
    ).rejects.toThrow('offline');
    expect(readSpoolStatus(spool).inFlightEvents).toBe(1);
  });

  it('flushes and removes accepted events', async () => {
    const spool = paths();
    const event = makeEvent();
    enqueueAgentEvent({ installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event }, spool);
    const result = await flushAgentEventSpool(
      async ({ events }) => ({
        accepted: events.map((item) => item.eventId),
        duplicates: [],
        rejected: [],
      }),
      spool,
    );
    expect(result).toMatchObject({ claimed: 1, accepted: 1, remaining: 0 });
    expect(readSpoolStatus(spool).queuedEvents).toBe(0);
  });

  it('rejects new telemetry after atomic logout cleanup until re-enabled', () => {
    const spool = paths();
    clearAgentTelemetry(spool);
    expect(() =>
      enqueueAgentEvent(
        { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: makeEvent() },
        spool,
      ),
    ).toThrow('disabled until the next successful login');
  });

  it('clears queue, inflight, and quarantine data for logout/account deletion', () => {
    const spool = paths();
    enqueueAgentEvent(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: makeEvent() },
      spool,
    );
    claimAgentEventBatch(spool);
    const queued = makeEvent();
    enqueueAgentEvent(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: queued },
      spool,
    );
    claimAgentEventBatch(spool);
    completeAgentEventBatch(
      { accepted: [], duplicates: [], rejected: [{ eventId: queued.eventId, reason: 'invalid' }] },
      spool,
    );
    clearAgentEventSpool(spool);
    expect(readSpoolStatus(spool)).toMatchObject({
      queuedEvents: 0,
      inFlightEvents: 0,
      quarantinedEvents: 0,
    });
  });
});
