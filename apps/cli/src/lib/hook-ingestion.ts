import { createHmac } from 'node:crypto';

import {
  AGENT_ADAPTER_VERSION,
  AGENT_EVENT_TYPES,
  AGENT_PROVIDERS,
  AgentEventType,
  AgentLifecycleEventV1,
  AgentProvider,
  sanitizeHookPayload,
} from '@ateva/agent-protocol';

const MAX_HOOK_INPUT_BYTES = 256 * 1024;
const MAX_IDENTIFIER_LENGTH = 512;

const SAFE_INPUT_KEYS = new Set([
  'eventId',
  'event_id',
  'id',
  'idempotencyKey',
  'idempotency_key',
  'sequence',
  'occurredAt',
  'occurred_at',
  'timestamp',
  'createdAt',
  'created_at',
  'sessionId',
  'session_id',
  'turnId',
  'turn_id',
  'taskId',
  'task_id',
  'correlationId',
  'correlation_id',
  'workspaceId',
  'workspace_id',
  'providerVersion',
  'provider_version',
  'clientVersion',
  'client_version',
  'success',
  'failureCategory',
  'failure_category',
  'fileCountBucket',
  'file_count_bucket',
  'elapsedDurationBucket',
  'elapsed_duration_bucket',
  'toolCallCount',
  'tool_call_count',
  'subagentCount',
  'subagent_count',
  'permissionMode',
  'permission_mode',
  'exitCodeCategory',
  'exit_code_category',
  'operatingSystem',
  'operating_system',
  'changedFileCountBucket',
  'changed_file_count_bucket',
  'toolFamily',
]);

const EVENT_TYPE_BY_NAME: Record<string, AgentEventType> = {
  sessionstart: 'session.started',
  sessionstarted: 'session.started',
  sessionresume: 'session.resumed',
  sessionresumed: 'session.resumed',
  sessionpause: 'session.paused',
  sessionpaused: 'session.paused',
  sessionend: 'session.ended',
  sessionended: 'session.ended',
  userpromptsubmit: 'turn.submitted',
  turnsubmitted: 'turn.submitted',
  turnprocessstarted: 'turn.processing_started',
  processingstarted: 'turn.processing_started',
  turnprocessingstarted: 'turn.processing_started',
  turnprocessstopped: 'turn.processing_stopped',
  processingstopped: 'turn.processing_stopped',
  turnprocessingstopped: 'turn.processing_stopped',
  stop: 'turn.completed',
  turncompleted: 'turn.completed',
  stopfailure: 'turn.failed',
  turnfailed: 'turn.failed',
  turncancelled: 'turn.cancelled',
  pretooluse: 'tool.started',
  toolstarted: 'tool.started',
  posttooluse: 'tool.succeeded',
  toolsucceeded: 'tool.succeeded',
  posttoolusefailure: 'tool.failed',
  toolfailed: 'tool.failed',
  posttoolbatch: 'tool.batch_completed',
  toolbatchcompleted: 'tool.batch_completed',
  permissionrequest: 'permission.required',
  permissionrequired: 'permission.required',
  permissionallowed: 'permission.allowed',
  permissiongranted: 'permission.allowed',
  permissiondenied: 'permission.denied',
  inputrequired: 'input.required',
  inputresolved: 'input.resolved',
  subagentstart: 'subagent.started',
  subagentstarted: 'subagent.started',
  subagentstop: 'subagent.stopped',
  subagentstopped: 'subagent.stopped',
  taskcreated: 'task.created',
  taskcompleted: 'task.completed',
  taskfailed: 'task.failed',
};

export type HookNormalizationOptions = {
  provider: AgentProvider;
  providerEvent: string;
  input: unknown;
  installationId: string;
  deviceId: string;
  environmentKind?: AgentLifecycleEventV1['environmentKind'];
  environmentId?: string;
  identifierSecret?: string | null;
  now?: Date;
  clientVersion?: string;
  adapterVersion?: string;
};

export function normalizeHookEvent(
  options: HookNormalizationOptions,
): AgentLifecycleEventV1 | null {
  // Codex native hooks remain disabled until an authoritative lifecycle
  // schema and trust contract are verified. This boundary protects callers
  // that use the generic normalizer directly instead of runHookIngest().
  if (options.provider === 'codex_cli') return null;
  const eventType = resolveEventType(options.providerEvent);
  if (!eventType || !isProvider(options.provider)) return null;
  if (!isRecord(options.input)) return null;
  if (!isValidInstallationId(options.installationId) || !isUuid(options.deviceId)) return null;

  // Project the provider object before sanitizing. Provider hooks commonly
  // contain prompt/tool/path/transcript fields; they are intentionally never
  // passed to the canonical sanitizer or persisted.
  const projected = projectSafeInput(options.input);
  let sanitized: ReturnType<typeof sanitizeHookPayload>;
  try {
    sanitized = sanitizeHookPayload(options.provider, options.providerEvent, projected);
  } catch {
    return null;
  }

  const secret = options.identifierSecret?.trim() || null;
  const providerEventId = readIdentifier(options.input, [
    'eventId',
    'event_id',
    'id',
    'idempotencyKey',
    'idempotency_key',
  ]);
  const sessionId = readIdentifier(options.input, ['sessionId', 'session_id']);
  const turnId = readIdentifier(options.input, ['turnId', 'turn_id']);
  const taskId = readIdentifier(options.input, ['taskId', 'task_id']);
  const workspaceId = readIdentifier(options.input, ['workspaceId', 'workspace_id']);
  const occurredAtValue = readSafeString(options.input, [
    'occurredAt',
    'occurred_at',
    'timestamp',
    'createdAt',
    'created_at',
  ]);
  const occurredAt = readTimestamp(options.input, options.now ?? new Date());
  const replayMaterial = [
    options.provider,
    eventType,
    providerEventId ?? '',
    sessionId ?? '',
    turnId ?? '',
    taskId ?? '',
    occurredAtValue ?? '',
    JSON.stringify(sanitized.metadata),
  ].join('|');
  const replayHash = hashReplayMaterial(secret ?? options.installationId, replayMaterial);
  const correlationId = hashIdentifier(secret, sessionId) ?? `hook:${replayHash.slice(0, 32)}`;

  return {
    schemaVersion: 1,
    eventId: `00000000-0000-4000-8000-${replayHash.slice(0, 12)}`,
    idempotencyKey: `hook:${replayHash}`,
    environmentKind: options.environmentKind ?? resolveEnvironmentKind(),
    environmentId: options.environmentId ?? process.env.ATEVA_ENVIRONMENT_ID ?? 'local',
    installationId: options.installationId,
    deviceId: options.deviceId,
    provider: options.provider,
    integrationMode: 'native_hook',
    ...(hashIdentifier(secret, sessionId)
      ? { providerSessionHash: hashIdentifier(secret, sessionId) }
      : {}),
    ...(hashIdentifier(secret, turnId) ? { providerTurnHash: hashIdentifier(secret, turnId) } : {}),
    ...(hashIdentifier(secret, taskId) ? { providerTaskHash: hashIdentifier(secret, taskId) } : {}),
    ...(hashIdentifier(secret, workspaceId)
      ? { workspaceHash: hashIdentifier(secret, workspaceId) }
      : {}),
    eventType,
    // Hook execution is a strong integration signal but remains client-side
    // telemetry, not independent proof or financial authority.
    sourceType: 'inferred',
    confidence: 0.8,
    occurredAt: occurredAt.toISOString(),
    ...(readSequence(options.input) !== undefined ? { sequence: readSequence(options.input) } : {}),
    correlationId,
    adapterVersion: options.adapterVersion ?? AGENT_ADAPTER_VERSION,
    clientVersion: options.clientVersion ?? AGENT_ADAPTER_VERSION,
    ...(readSafeString(options.input, ['providerVersion', 'provider_version'])
      ? { providerVersion: readSafeString(options.input, ['providerVersion', 'provider_version']) }
      : {}),
    metadata: sanitized.metadata,
  };
}

export function resolveEventType(providerEvent: string): AgentEventType | null {
  const normalized = providerEvent
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const eventType = EVENT_TYPE_BY_NAME[normalized];
  return eventType && AGENT_EVENT_TYPES.includes(eventType) ? eventType : null;
}

export function projectSafeInput(input: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of SAFE_INPUT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) projected[key] = input[key];
  }
  // Normalize accepted snake_case aliases to the canonical metadata names so
  // provider spelling differences do not silently lose safe fields.
  for (const [source, target] of [
    ['failure_category', 'failureCategory'],
    ['file_count_bucket', 'fileCountBucket'],
    ['elapsed_duration_bucket', 'elapsedDurationBucket'],
    ['tool_call_count', 'toolCallCount'],
    ['subagent_count', 'subagentCount'],
    ['permission_mode', 'permissionMode'],
    ['exit_code_category', 'exitCodeCategory'],
    ['operating_system', 'operatingSystem'],
    ['changed_file_count_bucket', 'changedFileCountBucket'],
  ]) {
    if (projected[target] === undefined && projected[source] !== undefined) {
      projected[target] = projected[source];
    }
    delete projected[source];
  }
  return projected;
}

export function readHookInputJson(raw: string, maxBytes = MAX_HOOK_INPUT_BYTES): unknown | null {
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function maxHookInputBytes(): number {
  return MAX_HOOK_INPUT_BYTES;
}

function readIdentifier(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() && value.length <= MAX_IDENTIFIER_LENGTH) {
      return value.trim();
    }
  }
  return undefined;
}

function hashIdentifier(secret: string | null, value: string | undefined): string | undefined {
  if (!secret || !value) return undefined;
  return createHmac('sha256', secret).update(value).digest('hex');
}

function hashReplayMaterial(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function readTimestamp(input: Record<string, unknown>, fallback: Date): Date {
  const value = readSafeString(input, [
    'occurredAt',
    'occurred_at',
    'timestamp',
    'createdAt',
    'created_at',
  ]);
  if (!value) return fallback;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp : fallback;
}

function readSequence(input: Record<string, unknown>): number | undefined {
  for (const key of ['sequence']) {
    const value = input[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000_000) {
      return value;
    }
  }
  return undefined;
}

function readSafeString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() && value.length <= 256) return value.trim();
  }
  return undefined;
}

function isProvider(value: string): value is AgentProvider {
  return (AGENT_PROVIDERS as readonly string[]).includes(value);
}

function isValidInstallationId(value: string): boolean {
  return value.length >= 16 && value.length <= 256;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveEnvironmentKind(): AgentLifecycleEventV1['environmentKind'] {
  const candidate = process.env.ATEVA_ENVIRONMENT_KIND;
  if (
    candidate === 'development' ||
    candidate === 'test' ||
    candidate === 'sandbox' ||
    candidate === 'staging' ||
    candidate === 'production'
  ) {
    return candidate;
  }
  return 'development';
}
