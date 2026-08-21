import { describe, expect, it } from 'vitest';

import { agentLifecycleEventSchema } from '@ateva/agent-protocol';

import { createGenericWrapperEvent, normalizeExecutableFamily } from './generic-wrapper-adapter';

const base = {
  installationId: 'installation-123456789',
  deviceId: '11111111-1111-4111-8111-111111111111',
  correlationId: 'wrapper-session-1',
  executable: '/home/private/projects/secret-agent/claude',
};

describe('generic wrapper adapter', () => {
  it('normalizes executable families without retaining paths or arguments', () => {
    expect(normalizeExecutableFamily('/usr/local/bin/claude')).toBe('claude_code');
    expect(normalizeExecutableFamily('codex.exe')).toBe('codex_cli');
    expect(normalizeExecutableFamily('aider')).toBe('aider');
    expect(normalizeExecutableFamily('/private/custom-agent')).toBe('other');

    const event = createGenericWrapperEvent({
      ...base,
      executable: base.executable,
      eventType: 'session.started',
      occurredAt: new Date('2026-08-05T12:00:00.000Z'),
    });
    expect(event).toMatchObject({
      provider: 'generic_wrapper',
      integrationMode: 'wrapper',
      eventType: 'session.started',
      sourceType: 'inferred',
      confidence: 0.5,
      metadata: { executableFamily: 'claude_code' },
    });
    expect(JSON.stringify(event)).not.toContain('/home/private');
    expect(JSON.stringify(event)).not.toContain('secret-agent');
    expect(agentLifecycleEventSchema.parse(event)).toEqual(event);
  });

  it('records coarse completion outcome and duration only', () => {
    const event = createGenericWrapperEvent({
      ...base,
      executable: 'codex',
      eventType: 'session.ended',
      occurredAt: new Date('2026-08-05T12:00:02.000Z'),
      durationMs: 31_000,
      exitCode: 0,
    });

    expect(event.metadata).toEqual({
      executableFamily: 'codex_cli',
      elapsedDurationBucket: '30_120s',
      exitCodeCategory: 'success',
      success: true,
    });
  });

  it('classifies cancellation signals without exposing command details', () => {
    const event = createGenericWrapperEvent({
      ...base,
      executable: 'custom-agent',
      eventType: 'turn.cancelled',
      signal: 'SIGINT',
    });

    expect(event.metadata).toEqual({
      executableFamily: 'other',
      exitCodeCategory: 'signal_interrupt',
    });
  });

  it('reuses the same event identity when a lifecycle event is reconstructed', () => {
    const input = {
      ...base,
      executable: 'claude',
      eventType: 'session.ended' as const,
      occurredAt: new Date('2026-08-05T12:00:02.000Z'),
      durationMs: 2_000,
      exitCode: 0,
    };
    const first = createGenericWrapperEvent(input);
    const second = createGenericWrapperEvent({
      ...input,
      occurredAt: new Date('2026-08-05T12:00:03.000Z'),
    });
    expect(second.eventId).toBe(first.eventId);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
