import { describe, expect, it } from 'vitest';

import {
  adaptClaudeCodeHook,
  CLAUDE_CODE_ADAPTER_VERSION,
  CLAUDE_CODE_HOOK_EVENTS,
  normalizeToolFamily,
} from './claude-code-adapter';

const SESSION_ID = 'claude-session-123';

const dirtyClaudePayload = {
  event_id: 'claude-event-1',
  session_id: SESSION_ID,
  timestamp: '2026-08-04T12:00:00.000Z',
  tool_name: 'Bash',
  tool_use_id: 'tool-123',
  prompt: 'do not retain this prompt',
  tool_input: { command: 'cat /home/user/private.txt' },
  tool_output: 'source code and terminal output must not leave the process',
  transcript_path: '/home/user/.claude/transcript.jsonl',
  cwd: '/home/user/workspace',
  success: true,
};

describe('Claude Code adapter', () => {
  it('supports the documented lifecycle event set', () => {
    expect(CLAUDE_CODE_HOOK_EVENTS).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'PostToolUseFailure',
      'PostToolBatch',
      'SubagentStart',
      'SubagentStop',
      'TaskCreated',
      'TaskCompleted',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ]);
    expect(adaptClaudeCodeHook('SessionStart', {})).toMatchObject({
      providerEvent: 'SessionStart',
      adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
    });
  });

  it('projects only safe identifiers and coarse metadata', () => {
    const adapted = adaptClaudeCodeHook('PostToolUse', dirtyClaudePayload);
    expect(adapted).toEqual({
      providerEvent: 'PostToolUse',
      adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
      input: {
        event_id: 'claude-event-1',
        session_id: SESSION_ID,
        timestamp: '2026-08-04T12:00:00.000Z',
        turn_id: 'tool-123',
        toolFamily: 'shell',
        success: true,
      },
    });
    expect(JSON.stringify(adapted)).not.toContain('private.txt');
    expect(JSON.stringify(adapted)).not.toContain('transcript');
    expect(JSON.stringify(adapted)).not.toContain('do not retain');
    expect(JSON.stringify(adapted)).not.toContain('source code');
  });

  it('marks failure lifecycle events unsuccessful without trusting raw result objects', () => {
    expect(adaptClaudeCodeHook('PostToolUseFailure', { success: true })).toMatchObject({
      input: { success: false },
    });
    expect(adaptClaudeCodeHook('StopFailure', { success: true })).toMatchObject({
      input: { success: false },
    });
  });

  it('accepts safe Claude metadata aliases and drops unsupported events', () => {
    expect(
      adaptClaudeCodeHook('PermissionRequest', {
        sessionId: SESSION_ID,
        permissionMode: 'default',
        sequence: 4,
        command_args: ['--secret'],
      }),
    ).toMatchObject({
      input: {
        session_id: SESSION_ID,
        permission_mode: 'default',
        sequence: 4,
      },
    });
    expect(adaptClaudeCodeHook('UnknownEvent', {})).toBeNull();
    expect(adaptClaudeCodeHook('Stop', [])).toBeNull();
  });

  it('normalizes Claude tool names into privacy-safe categories', () => {
    expect(normalizeToolFamily('Bash')).toBe('shell');
    expect(normalizeToolFamily('Edit')).toBe('editor');
    expect(normalizeToolFamily('Grep')).toBe('search');
    expect(normalizeToolFamily('mcp__server__tool')).toBe('mcp');
    expect(normalizeToolFamily('UnknownProviderTool')).toBe('other');
    expect(normalizeToolFamily('')).toBeUndefined();
  });
});
