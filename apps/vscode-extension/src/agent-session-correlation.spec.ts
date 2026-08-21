import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { AgentLifecycleEventV1 } from '@ateva/agent-protocol';

import { AgentSessionCorrelation } from './agent-session-correlation';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = 'installation-correlation-test';
const NOW = '2026-08-05T12:00:00.000Z';

function event(overrides: Partial<AgentLifecycleEventV1> = {}): AgentLifecycleEventV1 {
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    environmentKind: 'test',
    environmentId: 'test-run',
    installationId: INSTALLATION_ID,
    deviceId: DEVICE_ID,
    provider: 'claude_code',
    integrationMode: 'native_hook',
    providerSessionHash: 'a'.repeat(64),
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.8,
    occurredAt: NOW,
    correlationId: 'correlation-1',
    adapterVersion: 'test',
    clientVersion: 'test',
    metadata: {},
    ...overrides,
  };
}

describe('AgentSessionCorrelation (WL-050)', () => {
  it('deduplicates event IDs and keeps one correlated session', () => {
    const correlation = new AgentSessionCorrelation();
    const first = event();

    expect(correlation.accept(first)).toMatchObject({ accepted: true, duplicate: false });
    expect(correlation.accept(first)).toMatchObject({ accepted: false, duplicate: true });
    expect(correlation.values()).toHaveLength(1);
    expect(correlation.values()[0]?.eventCount).toBe(1);
  });

  it('gives native events precedence over wrapper observations', () => {
    const correlation = new AgentSessionCorrelation();
    const native = event();
    correlation.accept(
      event({
        providerSessionHash: undefined,
        correlationId: 'wrapper-correlation',
        integrationMode: 'wrapper',
        provider: 'generic_wrapper',
        metadata: { executableFamily: 'claude_code' },
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        eventType: 'turn.processing_started',
      }),
    );
    const update = correlation.accept(native);

    expect(update.session.integrationMode).toBe('native_hook');
    expect(update.session.sourcePriority).toBe(3);
  });

  it('uses the bounded fallback only for one matching session and keeps parallel sessions separate', () => {
    const correlation = new AgentSessionCorrelation();
    correlation.accept(
      event({
        providerSessionHash: undefined,
        correlationId: 'wrapper-session',
        provider: 'generic_wrapper',
        integrationMode: 'wrapper',
        metadata: { executableFamily: 'claude_code' },
      }),
    );
    const merged = correlation.accept(
      event({
        providerSessionHash: undefined,
        correlationId: 'native-session',
        eventType: 'turn.completed',
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    );
    expect(merged.session.eventCount).toBe(2);
    expect(correlation.values()).toHaveLength(1);

    correlation.accept(
      event({
        providerSessionHash: 'b'.repeat(64),
        correlationId: 'parallel-session',
        provider: 'generic_wrapper',
        integrationMode: 'wrapper',
        metadata: { executableFamily: 'claude_code' },
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        occurredAt: '2026-08-05T12:00:01.000Z',
      }),
    );
    expect(correlation.values()).toHaveLength(2);

    // With two plausible same-family candidates, a hashless event must not
    // guess; it becomes its own session rather than merging parallel runs.
    const ambiguous = correlation.accept(
      event({
        providerSessionHash: undefined,
        correlationId: 'ambiguous-session',
        provider: 'generic_wrapper',
        integrationMode: 'wrapper',
        metadata: { executableFamily: 'claude_code' },
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        occurredAt: '2026-08-05T12:00:02.000Z',
      }),
    );
    expect(ambiguous.session.key).toContain(':ambiguous-session');
    expect(correlation.values()).toHaveLength(3);
  });

  it('does not let stale lower-priority events overwrite a newer native terminal status', () => {
    const correlation = new AgentSessionCorrelation();
    const nativeEnd = event({
      eventType: 'session.ended',
      occurredAt: '2026-08-05T12:00:10.000Z',
      sequence: 10,
    });
    correlation.accept(nativeEnd);
    const staleWrapper = correlation.accept(
      event({
        providerSessionHash: nativeEnd.providerSessionHash,
        integrationMode: 'wrapper',
        provider: 'generic_wrapper',
        metadata: { executableFamily: 'claude_code' },
        eventType: 'turn.processing_started',
        occurredAt: NOW,
        sequence: 1,
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    );
    expect(staleWrapper.session.status).toBe('ended');
    expect(staleWrapper.session.lastSequence).toBe(10);
  });

  it('does not fallback-correlate a new hashless event into a terminal session', () => {
    const correlation = new AgentSessionCorrelation();
    correlation.accept(
      event({
        eventType: 'session.ended',
        occurredAt: '2026-08-05T12:00:10.000Z',
      }),
    );
    const update = correlation.accept(
      event({
        providerSessionHash: undefined,
        correlationId: 'new-run',
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        occurredAt: '2026-08-05T12:00:11.000Z',
      }),
    );
    expect(update.session.key).toContain(':new-run');
    expect(update.session.eventCount).toBe(1);
    expect(correlation.values()).toHaveLength(2);
  });

  it('uses deterministic ordering for equal sequence events', () => {
    const correlation = new AgentSessionCorrelation();
    const terminal = event({
      eventType: 'session.ended',
      sequence: 4,
      occurredAt: '2026-08-05T12:00:04.000Z',
    });
    correlation.accept(terminal);
    const stale = correlation.accept(
      event({
        providerSessionHash: terminal.providerSessionHash,
        eventType: 'turn.processing_started',
        sequence: 4,
        occurredAt: '2026-08-05T12:00:03.000Z',
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    );
    expect(stale.session.status).toBe('ended');
    expect(stale.session.lastEventId).toBe(terminal.eventId);
  });

  it('maps input, completion, failure, and cancellation without creating financial evidence', () => {
    const correlation = new AgentSessionCorrelation();
    const statuses = [
      ['input.required', 'waiting_for_input'],
      ['turn.completed', 'completed'],
      ['turn.failed', 'failed'],
      ['turn.cancelled', 'cancelled'],
    ] as const;

    for (const [eventType, status] of statuses) {
      const update = correlation.accept(
        event({
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          eventType,
        }),
      );
      expect(update.session.status).toBe(status);
    }
    expect(correlation.values()[0]).not.toHaveProperty('waitStateId');
    expect(correlation.values()[0]).not.toHaveProperty('impressionToken');
  });
});
