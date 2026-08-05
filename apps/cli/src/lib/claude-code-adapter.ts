export const CLAUDE_CODE_ADAPTER_VERSION = 'claude-code-0.0.1';

export const CLAUDE_CODE_HOOK_EVENTS = [
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
] as const;

export type ClaudeCodeHookEvent = (typeof CLAUDE_CODE_HOOK_EVENTS)[number];

export type ClaudeCodeAdapterResult = {
  providerEvent: ClaudeCodeHookEvent;
  input: Record<string, unknown>;
  adapterVersion: string;
};

const EVENT_SET = new Set<string>(CLAUDE_CODE_HOOK_EVENTS);

/**
 * Convert an official-shaped Claude Code hook payload into the small generic
 * input understood by hook-ingestion. The raw payload is never returned.
 *
 * Claude hooks can include prompts, transcript paths, CWDs, tool input/output,
 * and provider-specific response objects. None are needed for Release 0.x.
 */
export function adaptClaudeCodeHook(
  providerEvent: string,
  input: unknown,
): ClaudeCodeAdapterResult | null {
  if (!EVENT_SET.has(providerEvent)) return null;
  if (!isRecord(input)) return null;

  const event = providerEvent as ClaudeCodeHookEvent;
  const projected: Record<string, unknown> = {};

  copyString(input, projected, 'event_id', ['event_id', 'eventId', 'id']);
  copyString(input, projected, 'session_id', ['session_id', 'sessionId']);
  copyString(input, projected, 'timestamp', ['timestamp', 'occurred_at', 'occurredAt']);
  copyString(input, projected, 'provider_version', ['provider_version', 'providerVersion']);
  copyString(input, projected, 'workspace_id', ['workspace_id', 'workspaceId']);

  // Claude's stable operation identifiers are used only as local replay/
  // correlation material by normalizeHookEvent; they are HMACed there before
  // reaching the canonical event.
  copyString(input, projected, 'turn_id', ['turn_id', 'turnId', 'tool_use_id', 'toolUseId']);
  copyString(input, projected, 'task_id', [
    'task_id',
    'taskId',
    'agent_id',
    'agentId',
    'subagent_id',
    'subagentId',
  ]);

  const toolFamily = normalizeToolFamily(readString(input, ['tool_name', 'toolName']));
  if (toolFamily) projected.toolFamily = toolFamily;

  const success = eventSuccess(event, input);
  if (success !== undefined) projected.success = success;

  copySafeScalar(input, projected, 'failure_category', ['failure_category', 'failureCategory']);
  copySafeScalar(input, projected, 'permission_mode', ['permission_mode', 'permissionMode']);
  copySafeScalar(input, projected, 'exit_code_category', [
    'exit_code_category',
    'exitCodeCategory',
  ]);
  copySafeScalar(input, projected, 'tool_call_count', ['tool_call_count', 'toolCallCount']);
  copySafeScalar(input, projected, 'subagent_count', ['subagent_count', 'subagentCount']);
  copySafeScalar(input, projected, 'sequence', ['sequence']);

  return {
    providerEvent: event,
    input: projected,
    adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
  };
}

/** Return whether an event is supported by the current Claude adapter. */
export function isClaudeCodeHookEvent(value: string): value is ClaudeCodeHookEvent {
  return EVENT_SET.has(value);
}

/** Map a Claude tool name to a coarse, non-identifying protocol category. */
export function normalizeToolFamily(
  toolName: string | undefined,
): 'shell' | 'editor' | 'file' | 'search' | 'test' | 'network' | 'mcp' | 'other' | undefined {
  if (!toolName) return undefined;
  const normalized = toolName.trim().toLowerCase();
  if (!normalized || normalized.length > 64) return undefined;
  if (['bash', 'shell', 'terminal', 'command'].includes(normalized)) return 'shell';
  if (['edit', 'multiedit', 'notebookedit'].includes(normalized)) return 'editor';
  if (['write', 'filewrite', 'read', 'fileread'].includes(normalized)) return 'file';
  if (['glob', 'grep', 'search'].includes(normalized)) return 'search';
  if (['test', 'pytest', 'jest', 'vitest'].includes(normalized)) return 'test';
  if (['webfetch', 'websearch', 'http', 'network'].includes(normalized)) return 'network';
  if (normalized === 'mcp' || normalized.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function eventSuccess(
  event: ClaudeCodeHookEvent,
  input: Record<string, unknown>,
): boolean | undefined {
  if (event === 'PostToolUse' || event === 'PostToolBatch' || event === 'TaskCompleted') {
    return readBoolean(input, ['success']) ?? true;
  }
  if (event === 'PostToolUseFailure' || event === 'StopFailure') {
    return false;
  }
  if (event === 'PermissionRequest' || event === 'SessionStart' || event === 'SessionEnd') {
    return readBoolean(input, ['success']);
  }
  return readBoolean(input, ['success']);
}

function copyString(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  target: string,
  keys: string[],
): void {
  const value = readString(input, keys);
  if (value) output[target] = value;
}

function copySafeScalar(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  target: string,
  keys: string[],
): void {
  const value = readString(input, keys) ?? readNumber(input, keys);
  if (value !== undefined) output[target] = value;
}

function readString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() && value.length <= 512) return value.trim();
  }
  return undefined;
}

function readBoolean(input: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof input[key] === 'boolean') return input[key];
  }
  return undefined;
}

function readNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
