import { describe, expect, it } from 'vitest';

import {
  agentLifecycleBatchSchema,
  agentLifecycleEventSchema,
  canonicalAgentBatchPayload,
  canonicalAgentBatchPayloadFromUnknown,
  canonicalAgentMetadataSchema,
  getAgentProtocolCompatibility,
  isAgentEventTimestampBounded,
  normalizeFixture,
  sanitizeHookPayload,
  scanForbiddenAgentFields,
} from './index';

const baseEvent = {
  schemaVersion: 1 as const,
  eventId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'fixture-event-1',
  environmentKind: 'sandbox' as const,
  environmentId: 'sandbox-run-1',
  installationId: 'installation-123456789',
  deviceId: '11111111-1111-4111-8111-111111111112',
  provider: 'claude_code' as const,
  integrationMode: 'native_hook' as const,
  eventType: 'turn.completed' as const,
  sourceType: 'observed' as const,
  confidence: 1,
  occurredAt: '2026-08-04T12:00:00.000Z',
  correlationId: 'session-1',
  adapterVersion: '0.0.1',
  clientVersion: '0.0.1',
  metadata: { toolFamily: 'test' as const, success: true },
};

describe('@ateva/agent-protocol', () => {
  it('reports supported, unsupported, and malformed protocol versions', () => {
    expect(getAgentProtocolCompatibility(1)).toEqual({ supported: true, version: 1 });
    expect(getAgentProtocolCompatibility('1')).toEqual({ supported: true, version: 1 });
    expect(getAgentProtocolCompatibility(2)).toEqual({
      supported: false,
      version: 2,
      reason: 'unsupported',
    });
    expect(getAgentProtocolCompatibility('not-a-version')).toEqual({
      supported: false,
      version: null,
      reason: 'invalid',
    });
  });

  it('accepts a canonical lifecycle event and bounded batch', () => {
    expect(agentLifecycleEventSchema.parse(baseEvent)).toEqual(baseEvent);
    expect(
      agentLifecycleBatchSchema.parse({
        schemaVersion: 1,
        environmentId: baseEvent.environmentId,
        installationId: baseEvent.installationId,
        deviceId: baseEvent.deviceId,
        events: [baseEvent],
      }).events,
    ).toHaveLength(1);
  });

  it('rejects unknown metadata and event fields', () => {
    expect(() => agentLifecycleEventSchema.parse({ ...baseEvent, prompt: 'secret' })).toThrow();
    expect(() =>
      agentLifecycleEventSchema.parse({
        ...baseEvent,
        metadata: { ...baseEvent.metadata, command: 'npm test' },
      }),
    ).toThrow();
  });

  it('sanitizes provider fixtures to the explicit metadata allowlist', () => {
    expect(
      normalizeFixture({
        id: 'claude-completion',
        provider: 'claude_code',
        providerEvent: 'Stop',
        payload: { success: true, toolFamily: 'test', ignored: 'discarded' },
      }),
    ).toEqual({
      provider: 'claude_code',
      providerEvent: 'Stop',
      metadata: { success: true, toolFamily: 'test' },
    });
  });

  it('rejects planted prompt, source, command, and secret content before normalization', () => {
    for (const payload of [
      { prompt: 'fix this bug' },
      { source_code: 'const secret = 1' },
      { command: 'cat ~/.ssh/id_rsa' },
      { nested: { terminal_output: 'Bearer api_secret_123456789' } },
      { value: '-----BEGIN PRIVATE KEY-----' },
    ]) {
      expect(() => sanitizeHookPayload('codex_cli', 'Stop', payload)).toThrow();
    }
  });

  it('finds forbidden field names recursively for server-side defense in depth', () => {
    expect(
      scanForbiddenAgentFields({
        nested: [{ prompt: 'discard' }, { cwd: '/private' }, { terminalOutput: 'discard' }],
      }),
    ).toEqual(['<sensitive-value>', 'cwd', 'prompt', 'terminal_output']);
  });

  it('canonicalizes batch signing order deterministically', () => {
    const later = {
      ...baseEvent,
      eventId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-08-04T12:00:01.000Z',
    };
    const payload = canonicalAgentBatchPayload({
      schemaVersion: 1,
      environmentId: baseEvent.environmentId,
      installationId: baseEvent.installationId,
      deviceId: baseEvent.deviceId,
      events: [later, baseEvent],
    });
    expect((payload.events as Array<{ eventId: string }>)[0].eventId).toBe(baseEvent.eventId);
  });

  it('orders malformed raw events deterministically without locale or NaN dependence', () => {
    const malformedA = { occurredAt: 'not-a-date', sequence: Number.NaN, value: { z: 1, a: 2 } };
    const malformedB = {
      occurredAt: 'also-not-a-date',
      sequence: Number.NaN,
      value: { a: 2, z: 1 },
    };
    const first = canonicalAgentBatchPayloadFromUnknown({
      schemaVersion: 1,
      environmentId: baseEvent.environmentId,
      installationId: baseEvent.installationId,
      deviceId: baseEvent.deviceId,
      events: [malformedB, malformedA],
    });
    const second = canonicalAgentBatchPayloadFromUnknown({
      schemaVersion: 1,
      environmentId: baseEvent.environmentId,
      installationId: baseEvent.installationId,
      deviceId: baseEvent.deviceId,
      events: [malformedA, malformedB],
    });
    expect(first.events).toEqual(second.events);
  });

  it('bounds offline event timestamps and rejects invalid dates', () => {
    const now = Date.parse('2026-08-04T12:00:00.000Z');
    expect(isAgentEventTimestampBounded('2026-08-04T11:59:00.000Z', now)).toBe(true);
    expect(isAgentEventTimestampBounded('2026-07-27T11:59:59.999Z', now)).toBe(false);
    expect(isAgentEventTimestampBounded('2026-08-04T12:06:00.000Z', now)).toBe(false);
    expect(isAgentEventTimestampBounded('not-a-date', now)).toBe(false);
  });

  it('rejects oversized or deeply nested hook payloads before normalization', () => {
    expect(() =>
      sanitizeHookPayload('claude_code', 'Stop', { note: 'x'.repeat(16_385) }),
    ).toThrow();
    let nested: Record<string, unknown> = {};
    for (let i = 0; i < 9; i += 1) nested = { nested };
    expect(() => sanitizeHookPayload('claude_code', 'Stop', nested)).toThrow();
  });

  it('normalizes camelCase forbidden names and sensitive values', () => {
    expect(() =>
      sanitizeHookPayload('codex_cli', 'Stop', { commandArgs: ['rm', '-rf'] }),
    ).toThrow();
    expect(() =>
      sanitizeHookPayload('codex_cli', 'Stop', { note: 'Bearer token_123456789' }),
    ).toThrow();
    expect(() => sanitizeHookPayload('codex_cli', 'Stop', { note: 'user@example.com' })).toThrow();
  });

  it('never lets a provider payload declare its own executionContext', () => {
    // executionContext decides whether an event may become human-attention
    // inventory. It is stamped by the client from its own environment, so a
    // hook payload claiming `interactive` inside CI must not survive
    // sanitization — the field is absent from CANONICAL_METADATA_KEYS and is
    // therefore never copied out of provider input.
    const sanitized = sanitizeHookPayload('claude_code', 'Stop', {
      executionContext: 'interactive',
      execution_context: 'interactive',
      toolFamily: 'shell',
    });

    expect(sanitized.metadata.executionContext).toBeUndefined();
    expect(sanitized.metadata.toolFamily).toBe('shell');
  });

  it('accepts a locally stamped executionContext on the canonical schema', () => {
    expect(
      canonicalAgentMetadataSchema.parse({ executionContext: 'headless' }).executionContext,
    ).toBe('headless');
    expect(() => canonicalAgentMetadataSchema.parse({ executionContext: 'maybe' })).toThrow();
  });
});
