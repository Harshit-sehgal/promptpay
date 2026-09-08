import { describe, expect, it } from 'vitest';

import { type AgentLifecycleEventV1, scanForbiddenAgentFields } from '@ateva/agent-protocol';

import { buildShadowSessionFact } from './attention-shadow-facts';

const policy = {
  version: 1,
  status: 'shadow' as const,
  alphaPpm: 500_000n,
  passiveCapRatioPpm: 1_000_000n,
  passiveSessionCapMs: 60_000,
  minimumQualifiedMs: 1_000,
};

function event(
  eventId: string,
  eventType: AgentLifecycleEventV1['eventType'],
  occurredAt: string,
  metadata: AgentLifecycleEventV1['metadata'] = {},
): AgentLifecycleEventV1 {
  return {
    schemaVersion: 1,
    eventId,
    idempotencyKey: `idempotency-${eventId}`,
    environmentKind: 'sandbox',
    environmentId: 'sandbox-1',
    installationId: 'installation-123456789',
    deviceId: '11111111-1111-4111-8111-111111111111',
    provider: 'claude_code',
    integrationMode: 'native_hook',
    eventType,
    sourceType: 'observed',
    confidence: 0.9,
    occurredAt,
    correlationId: 'correlation-1',
    adapterVersion: '0.0.1',
    clientVersion: '0.0.1',
    metadata,
  };
}

const events = [
  event('11111111-1111-4111-8111-111111111111', 'surface.visible', '2026-08-31T00:00:00.000Z'),
  event(
    '22222222-2222-4222-8222-222222222222',
    'turn.processing_started',
    '2026-08-31T00:00:01.000Z',
    { toolFamily: 'shell' },
  ),
  event('33333333-3333-4333-8333-333333333333', 'input.required', '2026-08-31T00:00:07.000Z'),
  event('44444444-4444-4444-8444-444444444444', 'surface.hidden', '2026-08-31T00:00:08.000Z'),
] satisfies AgentLifecycleEventV1[];

describe('shadow session facts', () => {
  it('is deterministic, pseudonymous, and free of forbidden content', () => {
    const input = {
      sessionId: 'session-secret-id',
      userId: 'user-secret-id',
      deviceId: 'device-secret-id',
      pseudonymKey: 'operator-managed-test-key',
      environmentKind: 'sandbox' as const,
      environmentId: 'sandbox-1',
      provider: 'claude_code',
      integrationMode: 'native_hook',
      events,
      policy,
      startedAt: '2026-08-31T00:00:00.000Z',
      endedAt: '2026-08-31T00:00:10.000Z',
      observedAt: '2026-08-31T00:01:00.000Z',
      recordedAt: '2026-08-31T00:01:01.000Z',
    };
    const first = buildShadowSessionFact(input);
    const second = buildShadowSessionFact({ ...input, events: [...events].reverse() });

    expect(first.fact).toEqual(second.fact);
    expect(first.measurement).toMatchObject({
      renderedMs: 10_000,
      viewableMs: 8_000,
      aiEligibleMs: 6_000,
      qualifiedMs: 6_000,
      passiveMs: 2_000,
      passiveBillableMs: 2_000,
    });
    expect(first.fact.sessionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.fact.userKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.fact).not.toHaveProperty('sessionId');
    expect(first.fact).not.toHaveProperty('userId');
    expect(
      JSON.stringify(first.fact, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain('session-secret-id');
    expect(scanForbiddenAgentFields(first.fact)).toEqual([]);
    expect(first.financialSideEffects).toBe(false);
  });

  it('rejects path-like environment identifiers and never qualifies headless work', () => {
    expect(() =>
      buildShadowSessionFact({
        sessionId: 'session-1',
        userId: 'user-1',
        deviceId: 'device-1',
        pseudonymKey: 'key',
        environmentKind: 'test',
        environmentId: '/full/working/directory',
        provider: 'claude_code',
        integrationMode: 'native_hook',
        events,
        policy,
        endedAt: '2026-08-31T00:00:10.000Z',
      }),
    ).toThrow();

    const headless = buildShadowSessionFact({
      sessionId: 'session-2',
      userId: 'user-2',
      deviceId: 'device-2',
      pseudonymKey: 'key',
      environmentKind: 'test',
      environmentId: 'test-1',
      provider: 'claude_code',
      integrationMode: 'native_hook',
      events: events.map((item) => ({
        ...item,
        metadata: { ...item.metadata, executionContext: 'headless' as const },
      })),
      policy,
      endedAt: '2026-08-31T00:00:10.000Z',
    });

    expect(headless.fact.qualifiedMs).toBe(0);
    expect(headless.fact.passiveBillableMs).toBe(0);
  });

  it('counts rejected provider events as unknown telemetry', () => {
    const result = buildShadowSessionFact({
      sessionId: 'session-rejected',
      userId: 'user-rejected',
      deviceId: 'device-rejected',
      pseudonymKey: 'key',
      environmentKind: 'test',
      environmentId: 'test-1',
      provider: 'claude_code',
      integrationMode: 'native_hook',
      events: [
        event('55555555-5555-4555-8555-555555555555', 'event.rejected', '2026-08-31T00:00:01.000Z'),
      ],
      policy,
      endedAt: '2026-08-31T00:00:02.000Z',
    });

    expect(result.fact.unknownEventRatePpm).toBe(1_000_000n);
  });
});
