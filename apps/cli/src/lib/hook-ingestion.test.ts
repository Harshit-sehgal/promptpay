import { describe, expect, it, vi } from 'vitest';

import {
  normalizeHookEvent,
  projectSafeInput,
  readHookInputJson,
  resolveEventType,
} from './hook-ingestion';

const INSTALLATION_ID = 'installation-123456789';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'device-event-secret';

const baseInput = {
  event_id: 'provider-event-1',
  session_id: 'provider-session-1',
  turn_id: 'provider-turn-1',
  timestamp: '2026-08-04T12:00:00.000Z',
  success: true,
  toolFamily: 'test',
  prompt: 'never retain this prompt',
  tool_input: { command: 'cat secret.txt' },
  transcript_path: '/home/user/.provider/transcript.jsonl',
};

describe('hook ingestion normalization', () => {
  it('maps provider lifecycle names to canonical event names', () => {
    expect(resolveEventType('SessionStart')).toBe('session.started');
    expect(resolveEventType('PostToolUseFailure')).toBe('tool.failed');
    expect(resolveEventType('StopFailure')).toBe('turn.failed');
    expect(resolveEventType('unknown-event')).toBeNull();
  });

  it('projects only safe fields before sanitization', () => {
    const projected = projectSafeInput(baseInput);
    expect(projected).toEqual({
      event_id: 'provider-event-1',
      session_id: 'provider-session-1',
      turn_id: 'provider-turn-1',
      timestamp: '2026-08-04T12:00:00.000Z',
      success: true,
      toolFamily: 'test',
    });
    expect(JSON.stringify(projected)).not.toContain('secret.txt');
    expect(JSON.stringify(projected)).not.toContain('prompt');
  });

  it('normalizes safe snake_case metadata aliases', () => {
    const projected = projectSafeInput({ failure_category: 'timeout', tool_call_count: 2 });
    expect(projected).toEqual({ failureCategory: 'timeout', toolCallCount: 2 });
  });

  it('normalizes an observed event without retaining raw provider data', () => {
    const event = normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'PostToolUse',
      input: baseInput,
      installationId: INSTALLATION_ID,
      deviceId: DEVICE_ID,
      identifierSecret: SECRET,
      environmentKind: 'test',
      environmentId: 'test-run',
    });

    expect(event).toMatchObject({
      schemaVersion: 1,
      environmentKind: 'test',
      installationId: INSTALLATION_ID,
      deviceId: DEVICE_ID,
      provider: 'claude_code',
      integrationMode: 'native_hook',
      eventType: 'tool.succeeded',
      sourceType: 'inferred',
      confidence: 0.8,
      metadata: { success: true, toolFamily: 'test' },
    });
    expect(event?.providerSessionHash).toHaveLength(64);
    expect(event?.providerTurnHash).toHaveLength(64);
    expect(JSON.stringify(event)).not.toContain('secret.txt');
    expect(JSON.stringify(event)).not.toContain('provider-session-1');
    expect(JSON.stringify(event)).not.toContain('never retain');
  });

  it('stamps executionContext from this process, not from the provider payload', () => {
    const interactive = normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'Stop',
      input: baseInput,
      installationId: INSTALLATION_ID,
      deviceId: DEVICE_ID,
    });
    expect(interactive?.metadata.executionContext).toBe('interactive');

    // A hook firing inside a CI job records the agent work but must be barred
    // from generating human-attention inventory server-side.
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    const headless = normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'Stop',
      input: baseInput,
      installationId: INSTALLATION_ID,
      deviceId: DEVICE_ID,
    });
    expect(headless?.metadata.executionContext).toBe('headless');
    vi.unstubAllEnvs();
  });

  it('ignores a provider payload that tries to claim it is interactive', () => {
    vi.stubEnv('CI', 'true');
    const event = normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'Stop',
      input: { ...baseInput, executionContext: 'interactive', execution_context: 'interactive' },
      installationId: INSTALLATION_ID,
      deviceId: DEVICE_ID,
    });

    expect(event?.metadata.executionContext).toBe('headless');
    vi.unstubAllEnvs();
  });

  it('rejects Codex at the generic normalization boundary while native support is disabled', () => {
    expect(
      normalizeHookEvent({
        provider: 'codex_cli',
        providerEvent: 'SessionStart',
        input: { session_id: 'provider-session-1' },
        installationId: INSTALLATION_ID,
        deviceId: DEVICE_ID,
        environmentKind: 'test',
      }),
    ).toBeNull();
  });

  it('replays the same sanitized hook with the same event identity without a device secret', () => {
    const first = normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'SessionStart',
      input: { session_id: 'session-1', timestamp: '2026-08-04T12:00:00.000Z' },
      installationId: INSTALLATION_ID,
      deviceId: DEVICE_ID,
      environmentKind: 'test',
      environmentId: 'test-run',
    });
    const second = normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'SessionStart',
      input: { session_id: 'session-1', timestamp: '2026-08-04T12:00:00.000Z' },
      installationId: INSTALLATION_ID,
      deviceId: DEVICE_ID,
      environmentKind: 'test',
      environmentId: 'test-run',
    });
    expect(second?.eventId).toBe(first?.eventId);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  it('rejects unsupported providers, events, bad identities, and invalid input', () => {
    expect(
      normalizeHookEvent({
        provider: 'unknown',
        providerEvent: 'NotARealEvent',
        input: {},
        installationId: INSTALLATION_ID,
        deviceId: DEVICE_ID,
      }),
    ).toBeNull();
    expect(
      normalizeHookEvent({
        provider: 'claude_code',
        providerEvent: 'SessionStart',
        input: {},
        installationId: 'short',
        deviceId: DEVICE_ID,
      }),
    ).toBeNull();
    expect(
      normalizeHookEvent({
        provider: 'claude_code',
        providerEvent: 'SessionStart',
        input: [],
        installationId: INSTALLATION_ID,
        deviceId: DEVICE_ID,
      }),
    ).toBeNull();
  });

  it('bounds stdin JSON by bytes and requires an object', () => {
    expect(readHookInputJson('{"ok":true}')).toEqual({ ok: true });
    expect(readHookInputJson('[]')).toBeNull();
    expect(readHookInputJson('{bad')).toBeNull();
    expect(readHookInputJson('{"value":"1234567890"}', 5)).toBeNull();
  });
});
