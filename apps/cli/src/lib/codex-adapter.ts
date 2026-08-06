export const CODEX_ADAPTER_VERSION = 'codex-cli-hooks-0.1.0';

export type CodexTrustStatus = 'unverified' | 'trusted' | 'managed' | 'disabled';

export type CodexCapabilityStatus = {
  provider: 'codex_cli';
  adapterVersion: string;
  supported: true;
  trustStatus: CodexTrustStatus;
  reason: string;
  configPath?: string;
};

export type CodexHookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Stop';

export type CodexAdapterResult = {
  supported: true;
  providerEvent: CodexHookEvent;
  input: Record<string, unknown>;
  adapterVersion: string;
};

const CODEX_HOOK_EVENTS = new Set<string>([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop',
]);

/**
 * Codex's current command-hook wire shape is intentionally projected into the
 * same safe scalar subset as Claude hooks. Prompt, tool input/output, cwd,
 * transcript paths, and assistant messages are never returned to callers.
 */
export function adaptCodexHook(providerEvent: string, input: unknown): CodexAdapterResult | null {
  if (!CODEX_HOOK_EVENTS.has(providerEvent) || !isRecord(input)) return null;
  const projected: Record<string, unknown> = {};

  copyString(input, projected, 'event_id', ['event_id', 'eventId', 'id']);
  copyString(input, projected, 'session_id', ['session_id', 'sessionId']);
  copyString(input, projected, 'turn_id', ['turn_id', 'turnId']);
  copyString(input, projected, 'task_id', ['task_id', 'taskId', 'agent_id', 'agentId']);
  copyString(input, projected, 'timestamp', ['timestamp', 'occurred_at', 'occurredAt']);
  copyString(input, projected, 'provider_version', ['provider_version', 'providerVersion']);
  copyString(input, projected, 'workspace_id', ['workspace_id', 'workspaceId']);
  const toolFamily = normalizeToolFamily(readString(input, ['tool_name', 'toolName']));
  if (toolFamily) projected.toolFamily = toolFamily;
  copyString(input, projected, 'agent_type', ['agent_type', 'agentType']);
  copySafeScalar(input, projected, 'permission_mode', ['permission_mode', 'permissionMode']);
  copySafeScalar(input, projected, 'sequence', ['sequence']);

  const success = eventSuccess(providerEvent, input);
  if (success !== undefined) projected.success = success;

  return {
    supported: true,
    providerEvent: providerEvent as CodexHookEvent,
    input: projected,
    adapterVersion: CODEX_ADAPTER_VERSION,
  };
}

export function isCodexHookEvent(value: string): value is CodexHookEvent {
  return CODEX_HOOK_EVENTS.has(value);
}

/** Codex hooks are usable only after an explicit local trust decision. */
export function getCodexCapabilityStatus(
  configPath?: string,
  trustStatus: CodexTrustStatus = 'unverified',
): CodexCapabilityStatus {
  return {
    provider: 'codex_cli',
    adapterVersion: CODEX_ADAPTER_VERSION,
    supported: true,
    trustStatus,
    reason:
      trustStatus === 'trusted'
        ? 'Codex lifecycle hooks are supported and locally trusted'
        : 'Codex lifecycle hooks are supported but require explicit hook trust review',
    ...(configPath ? { configPath } : {}),
  };
}

export function isCodexNativeIntegrationTrusted(trustStatus = 'unverified'): boolean {
  return trustStatus === 'trusted' || trustStatus === 'managed';
}

function eventSuccess(event: string, input: Record<string, unknown>): boolean | undefined {
  if (event === 'Stop' || event === 'SubagentStop' || event === 'PostToolUse') return true;
  if (event === 'SessionStart' || event === 'SessionEnd') return readBoolean(input, ['success']);
  return readBoolean(input, ['success']);
}

function normalizeToolFamily(
  value: string | undefined,
): 'shell' | 'editor' | 'file' | 'search' | 'test' | 'network' | 'mcp' | 'other' | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 64) return undefined;
  if (['shell', 'exec', 'command', 'terminal'].includes(normalized)) return 'shell';
  if (['edit', 'apply_patch', 'write'].includes(normalized)) return 'editor';
  if (['read', 'cat'].includes(normalized)) return 'file';
  if (['search', 'grep', 'glob'].includes(normalized)) return 'search';
  if (['test', 'pytest', 'jest', 'vitest'].includes(normalized)) return 'test';
  if (['web_search', 'websearch', 'network'].includes(normalized)) return 'network';
  if (normalized === 'mcp' || normalized.startsWith('mcp')) return 'mcp';
  return 'other';
}

function readString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() && value.length <= 512) return value.trim();
  }
  return undefined;
}

function copyString(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  target: string,
  keys: string[],
): void {
  const value = keys.map((key) => input[key]).find((value) => typeof value === 'string');
  if (typeof value === 'string' && value.trim() && value.length <= 512)
    output[target] = value.trim();
}

function copySafeScalar(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  target: string,
  keys: string[],
): void {
  const value = keys
    .map((key) => input[key])
    .find((value) => typeof value === 'string' || typeof value === 'number');
  if (typeof value === 'string' && value.trim() && value.length <= 512)
    output[target] = value.trim();
  else if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10_000_000
  )
    output[target] = value;
}

function readBoolean(input: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof input[key] === 'boolean') return input[key] as boolean;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
