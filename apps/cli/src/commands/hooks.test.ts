import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getDeviceEventSecret: vi.fn(),
  sendAgentEventToBridge: vi.fn(),
  isDisabled: vi.fn(),
  isTrusted: vi.fn(),
}));

vi.mock('../lib/credentials', () => ({
  getCredentials: mocks.getCredentials,
  getDeviceEventSecret: mocks.getDeviceEventSecret,
}));
vi.mock('../lib/agent-bridge', () => ({
  sendAgentEventToBridge: mocks.sendAgentEventToBridge,
}));
vi.mock('../lib/hook-config', () => ({
  HookConfigManager: class {
    isDisabled = mocks.isDisabled;
    isTrusted = mocks.isTrusted;
  },
}));

import { runHookIngest } from './hooks';

const eventInput = JSON.stringify({
  event_id: 'provider-event-1',
  session_id: 'provider-session-1',
  turn_id: 'provider-turn-1',
  timestamp: '2026-08-04T12:00:00.000Z',
  tool_name: 'Bash',
  success: true,
  prompt: 'must never be sent',
  tool_input: { command: 'cat /home/user/private.txt' },
  tool_output: 'source code must never be sent',
  transcript_path: '/home/user/.claude/transcript.jsonl',
  cwd: '/home/user/workspace',
});

const credentials = {
  installationId: 'installation-123456789',
  deviceUUID: '11111111-1111-4111-8111-111111111111',
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'dev@example.test',
  userId: 'user-1',
  role: 'developer',
};

describe('runHookIngest', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.isDisabled.mockReturnValue(false);
    mocks.isTrusted.mockReturnValue(false);
  });

  it('delivers a sanitized event locally without invoking the API', async () => {
    mocks.getCredentials.mockResolvedValue(credentials);
    mocks.getDeviceEventSecret.mockResolvedValue('device-secret');
    mocks.sendAgentEventToBridge.mockResolvedValue(undefined);

    await expect(
      runHookIngest({ provider: 'claude_code', event: 'SessionStart', input: eventInput }),
    ).resolves.toBe(true);

    expect(mocks.sendAgentEventToBridge).toHaveBeenCalledOnce();
    const [{ event }] = mocks.sendAgentEventToBridge.mock.calls[0] as [
      { event: Record<string, unknown> },
    ];
    expect(event.eventType).toBe('session.started');
    expect(event.adapterVersion).toBe('claude-code-0.0.1');
    expect(event.providerSessionHash).toHaveLength(64);
    expect(event.providerTurnHash).toHaveLength(64);
    expect(event.metadata).toMatchObject({ toolFamily: 'shell', success: true });
    expect(JSON.stringify(event)).not.toContain('must never be sent');
    expect(JSON.stringify(event)).not.toContain('provider-session-1');
    expect(JSON.stringify(event)).not.toContain('provider-turn-1');
    expect(JSON.stringify(event)).not.toContain('private.txt');
    expect(JSON.stringify(event)).not.toContain('transcript');
    expect(JSON.stringify(event)).not.toContain('source code');
  });

  it('does not deliver Claude events while the integration is explicitly disabled', async () => {
    mocks.getCredentials.mockResolvedValue(credentials);
    mocks.isDisabled.mockReturnValue(true);

    await expect(
      runHookIngest({ provider: 'claude_code', event: 'SessionStart', input: eventInput }),
    ).resolves.toBe(false);
    expect(mocks.sendAgentEventToBridge).not.toHaveBeenCalled();
  });

  it('returns false without credentials and does not throw for hook callers', async () => {
    mocks.getCredentials.mockResolvedValue(null);

    await expect(
      runHookIngest({ provider: 'claude_code', event: 'SessionStart', input: eventInput }),
    ).resolves.toBe(false);
    expect(mocks.sendAgentEventToBridge).not.toHaveBeenCalled();
  });

  it('rejects Codex native hooks without bridge delivery while trust is unverified', async () => {
    mocks.getCredentials.mockResolvedValue(credentials);
    await expect(
      runHookIngest({ provider: 'codex_cli', event: 'SessionStart', input: eventInput }),
    ).resolves.toBe(false);
    expect(mocks.sendAgentEventToBridge).not.toHaveBeenCalled();
  });

  it('delivers a trusted Codex stop hook after safe projection', async () => {
    mocks.getCredentials.mockResolvedValue(credentials);
    mocks.getDeviceEventSecret.mockResolvedValue('device-secret');
    mocks.isTrusted.mockReturnValue(true);
    mocks.sendAgentEventToBridge.mockResolvedValue(undefined);

    await expect(
      runHookIngest({
        provider: 'codex_cli',
        event: 'Stop',
        input: JSON.stringify({
          session_id: 'codex-session-1',
          turn_id: 'codex-turn-1',
          cwd: '/private/worktree',
          last_assistant_message: 'private output',
        }),
      }),
    ).resolves.toBe(true);
    const [{ event }] = mocks.sendAgentEventToBridge.mock.calls[0] as [
      { event: Record<string, unknown> },
    ];
    expect(event.provider).toBe('codex_cli');
    expect(event.eventType).toBe('turn.completed');
    expect(event.adapterVersion).toBe('codex-cli-hooks-0.1.0');
    expect(JSON.stringify(event)).not.toContain('private output');
    expect(JSON.stringify(event)).not.toContain('private/worktree');
  });

  it('rejects unsupported Claude hook events without bridge delivery', async () => {
    mocks.getCredentials.mockResolvedValue(credentials);
    await expect(
      runHookIngest({ provider: 'claude_code', event: 'UnknownEvent', input: eventInput }),
    ).resolves.toBe(false);
    expect(mocks.sendAgentEventToBridge).not.toHaveBeenCalled();
  });

  it('swallows local bridge failures so provider execution is not blocked', async () => {
    mocks.getCredentials.mockResolvedValue(credentials);
    mocks.getDeviceEventSecret.mockResolvedValue('device-secret');
    mocks.sendAgentEventToBridge.mockRejectedValue(new Error('spool unavailable'));

    await expect(
      runHookIngest({ provider: 'claude_code', event: 'Stop', input: eventInput }),
    ).resolves.toBe(false);
  });
});
