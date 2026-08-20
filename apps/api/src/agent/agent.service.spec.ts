import { describe, expect, it, vi } from 'vitest';

import { canonicalAgentBatchPayload } from '@ateva/agent-protocol';
import { signPayload } from '@ateva/shared';

import { AgentService } from './agent.service';

const USER_ID = 'user-1';
const DEVICE_ID = '11111111-1111-4111-8111-111111111112';
const SECRET = 'device-secret-for-agent-batch-tests';
const NOW = new Date();

function event(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    eventId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'event-1',
    environmentKind: 'test' as const,
    environmentId: 'test-run',
    installationId: 'installation-123456789',
    deviceId: DEVICE_ID,
    provider: 'claude_code' as const,
    integrationMode: 'native_hook' as const,
    eventType: 'turn.completed' as const,
    sourceType: 'observed' as const,
    confidence: 1,
    occurredAt: NOW.toISOString(),
    correlationId: 'session-1',
    adapterVersion: '0.0.1',
    clientVersion: '0.0.1',
    metadata: { toolFamily: 'test' as const, success: true },
    ...overrides,
  };
}

function makePrisma() {
  const tx = {
    $executeRaw: vi.fn(),
    agentLifecycleEvent: { findFirst: vi.fn(), create: vi.fn() },
    agentSession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    agentWorkUnit: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    adOpportunity: { upsert: vi.fn() },
  };
  const prisma = {
    device: { findFirst: vi.fn().mockResolvedValue({ id: DEVICE_ID, eventSecret: SECRET }) },
    agentLifecycleEvent: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx };
}

function makeService() {
  const { prisma, tx } = makePrisma();
  const service = new AgentService(
    prisma as never,
    {
      get: vi.fn((key: string, fallback: string) => {
        if (key === 'ATEVA_ENVIRONMENT_KIND') return 'test';
        if (key === 'ATEVA_ENVIRONMENT_ID') return 'test-run';
        return fallback;
      }),
    } as never,
  );
  return { service, prisma, tx };
}

function signedBatch(events: Array<Record<string, unknown>>) {
  const canonical = events as never;
  return {
    schemaVersion: 1,
    environmentId: 'test-run',
    installationId: 'installation-123456789',
    deviceId: DEVICE_ID,
    events,
    signature: signPayload(
      canonicalAgentBatchPayload({
        schemaVersion: 1,
        environmentId: 'test-run',
        installationId: 'installation-123456789',
        deviceId: DEVICE_ID,
        events: canonical,
      }),
      SECRET,
    ),
  };
}

describe('AgentService', () => {
  it('rejects unsupported or malformed protocol versions with machine-readable codes', async () => {
    const { service } = makeService();
    await expect(
      service.ingestBatch(USER_ID, {
        ...signedBatch([event()]),
        schemaVersion: 2,
      } as never),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'agent_protocol_unsupported_version' }),
    });
    await expect(
      service.ingestBatch(USER_ID, signedBatch([event()]), 'not-a-version'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'agent_protocol_invalid_version' }),
    });
    await expect(service.ingestBatch(USER_ID, signedBatch([event()]), '2')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'agent_protocol_unsupported_version' }),
    });
    await expect(
      service.ingestBatch(USER_ID, { ...signedBatch([event()]), environmentId: 'other-run' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'agent_environment_mismatch' }),
    });
  });

  it('accepts an event, projects a work unit, and never touches financial models', async () => {
    const { service, tx } = makeService();
    const storedSession = {
      id: 'session-row',
      userId: USER_ID,
      deviceId: DEVICE_ID,
      provider: 'claude_code',
    };
    const storedWorkUnit = { id: 'work-unit-row' };
    tx.agentLifecycleEvent.findFirst.mockResolvedValue(null);
    tx.agentSession.findUnique.mockResolvedValue(null);
    tx.agentSession.create.mockResolvedValue(storedSession);
    tx.agentWorkUnit.findFirst.mockResolvedValue(null);
    tx.agentWorkUnit.create.mockResolvedValue(storedWorkUnit);
    tx.agentLifecycleEvent.create.mockResolvedValue({});
    tx.adOpportunity.upsert.mockResolvedValue({});

    const acceptedEvent = event({
      providerTurnHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const result = await service.ingestBatch(USER_ID, signedBatch([acceptedEvent]));

    expect(result).toMatchObject({
      accepted: [event().eventId],
      duplicates: [],
      rejected: [],
      financialSideEffects: false,
    });
    expect(tx.agentWorkUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'turn' }) }),
    );
    expect(tx.agentLifecycleEvent.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('ledger');
  });

  it('returns a partial acknowledgement for a stale event while accepting a valid event', async () => {
    const { service, tx } = makeService();
    const valid = event({
      eventId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'event-2',
    });
    const stale = event({
      eventId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'event-3',
      occurredAt: '2020-01-01T00:00:00.000Z',
    });
    tx.agentLifecycleEvent.findFirst.mockResolvedValue(null);
    tx.agentSession.findUnique.mockResolvedValue(null);
    tx.agentSession.create.mockResolvedValue({
      id: 'session-row',
      userId: USER_ID,
      deviceId: DEVICE_ID,
      provider: 'claude_code',
    });
    tx.agentWorkUnit.findFirst.mockResolvedValue(null);
    tx.agentWorkUnit.create.mockResolvedValue({ id: 'work-unit-row' });
    tx.agentLifecycleEvent.create.mockResolvedValue({});

    const result = await service.ingestBatch(USER_ID, signedBatch([stale, valid]));

    expect(result.accepted).toEqual([valid.eventId]);
    expect(result.rejected).toEqual([{ eventId: stale.eventId, reason: 'timestamp_out_of_range' }]);
  });

  it('classifies an exact replay as a duplicate without creating another row', async () => {
    const { service, tx } = makeService();
    tx.agentLifecycleEvent.findFirst.mockResolvedValue({
      eventId: event().eventId,
      idempotencyKey: event().idempotencyKey,
      session: { userId: USER_ID, deviceId: DEVICE_ID },
    });

    const result = await service.ingestBatch(USER_ID, signedBatch([event()]));

    expect(result.duplicates).toEqual([event().eventId]);
    expect(tx.agentLifecycleEvent.create).not.toHaveBeenCalled();
    expect(tx.agentSession.create).not.toHaveBeenCalled();
  });

  it('rejects a same-key/different-event collision instead of treating it as a replay', async () => {
    const { service, tx } = makeService();
    tx.agentLifecycleEvent.findFirst.mockResolvedValue({
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      idempotencyKey: event().idempotencyKey,
      session: { userId: USER_ID, deviceId: DEVICE_ID },
    });

    const result = await service.ingestBatch(USER_ID, signedBatch([event()]));

    expect(result.duplicates).toEqual([]);
    expect(result.rejected).toEqual([{ eventId: event().eventId, reason: 'conflict' }]);
  });

  it('rejects telemetry appended to a session already reconciled as abandoned', async () => {
    const { service, tx } = makeService();
    tx.agentLifecycleEvent.findFirst.mockResolvedValue(null);
    tx.agentSession.findUnique.mockResolvedValue({
      id: 'session-row',
      userId: USER_ID,
      deviceId: DEVICE_ID,
      provider: 'claude_code',
      status: 'abandoned',
    });

    const result = await service.ingestBatch(USER_ID, signedBatch([event()]));

    expect(result.rejected).toEqual([{ eventId: event().eventId, reason: 'abandoned_session' }]);
    expect(tx.agentLifecycleEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a batch with no valid events before database persistence', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.ingestBatch(
        USER_ID,
        signedBatch([event({ occurredAt: '2020-01-01T00:00:00.000Z' })]),
      ),
    ).rejects.toThrow('no valid events');
    expect(prisma.device.findFirst).not.toHaveBeenCalled();
  });
});
