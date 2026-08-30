import { z } from 'zod';

export const AGENT_PROTOCOL_VERSION = 1 as const;
export const AGENT_SUPPORTED_SCHEMA_VERSIONS = [AGENT_PROTOCOL_VERSION] as const;
export const AGENT_PROTOCOL_VERSION_HEADER = 'X-Ateva-Agent-Protocol-Version' as const;
export const AGENT_ADAPTER_VERSION = '0.0.1';

export type AgentProtocolCompatibility =
  | { supported: true; version: typeof AGENT_PROTOCOL_VERSION }
  | { supported: false; version: number | null; reason: 'invalid' | 'unsupported' };

export function getAgentProtocolCompatibility(value: unknown): AgentProtocolCompatibility {
  const version =
    typeof value === 'number' && Number.isInteger(value)
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;
  if (version === AGENT_PROTOCOL_VERSION) return { supported: true, version };
  return {
    supported: false,
    version: typeof version === 'number' && Number.isSafeInteger(version) ? version : null,
    reason: version === null ? 'invalid' : 'unsupported',
  };
}

// Offline delivery is supported, but an event must still be recent enough to
// be meaningful and must not be scheduled far into the future. These bounds
// are protocol-level safety limits; deployments may apply a tighter window.
export const AGENT_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const AGENT_EVENT_MAX_FUTURE_MS = 5 * 60 * 1_000;

export const AGENT_PROVIDERS = [
  'claude_code',
  'codex_cli',
  'aider',
  'generic_wrapper',
  'vscode',
  'unknown',
] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_INTEGRATION_MODES = [
  'native_hook',
  'native_plugin',
  'wrapper',
  'vscode_observation',
  'heuristic_shadow',
] as const;
export type AgentIntegrationMode = (typeof AGENT_INTEGRATION_MODES)[number];

export const AGENT_EVENT_TYPES = [
  'session.started',
  'session.resumed',
  'session.paused',
  'session.ended',
  'turn.submitted',
  'turn.processing_started',
  'turn.processing_stopped',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
  'tool.started',
  'tool.succeeded',
  'tool.failed',
  'tool.batch_completed',
  'input.required',
  'input.resolved',
  'permission.required',
  'permission.allowed',
  'permission.denied',
  'subagent.started',
  'subagent.stopped',
  'task.created',
  'task.completed',
  'task.failed',
  'user.foregrounded',
  'user.backgrounded',
  'user.returned',
  'user.interacted',
  'device.locked',
  'device.unlocked',
  'surface.visible',
  'surface.hidden',
  'integration.connected',
  'integration.degraded',
  'integration.disconnected',
  'queue.backpressure',
  'event.rejected',
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const AGENT_EVENT_SOURCE_TYPES = ['observed', 'derived', 'inferred'] as const;
export type AgentEventSourceType = (typeof AGENT_EVENT_SOURCE_TYPES)[number];

export const AGENT_ENVIRONMENT_KINDS = [
  'development',
  'test',
  'sandbox',
  'staging',
  'production',
] as const;
export type AgentEnvironmentKind = (typeof AGENT_ENVIRONMENT_KINDS)[number];

export const CANONICAL_METADATA_KEYS = [
  'toolFamily',
  'executableFamily',
  'success',
  'failureCategory',
  'fileCountBucket',
  'elapsedDurationBucket',
  'toolCallCount',
  'subagentCount',
  'permissionMode',
  'exitCodeCategory',
  'operatingSystem',
  'changedFileCountBucket',
] as const;

export const AGENT_EXECUTION_CONTEXTS = ['interactive', 'headless'] as const;
export type AgentExecutionContext = (typeof AGENT_EXECUTION_CONTEXTS)[number];

export const canonicalAgentMetadataSchema = z
  .object({
    /**
     * Whether a human could have been present for this event.
     *
     * Deliberately absent from `CANONICAL_METADATA_KEYS`: every other field is
     * copied out of a provider payload, and this one must not be. A provider
     * hook running in CI has no business declaring itself `interactive`, so the
     * value is stamped locally by the client from its own environment after the
     * payload has been sanitized, and any provider-supplied value is dropped.
     *
     * This is a correctness control, not a security control. A hostile client
     * would simply claim `interactive`; the defense against that is independent
     * attestation, not this field. It exists so that honest headless usage — CI
     * jobs, remote build agents, cron-driven refactors — records its agent work
     * without ever manufacturing human-attention inventory.
     *
     * Absent means "unknown" (an older client), which is treated permissively
     * for backwards compatibility.
     */
    executionContext: z.enum(AGENT_EXECUTION_CONTEXTS).optional(),
    toolFamily: z
      .enum(['shell', 'editor', 'file', 'search', 'test', 'network', 'mcp', 'other'])
      .optional(),
    executableFamily: z.string().max(64).optional(),
    success: z.boolean().optional(),
    failureCategory: z.string().max(64).optional(),
    fileCountBucket: z.string().max(32).optional(),
    elapsedDurationBucket: z.string().max(32).optional(),
    toolCallCount: z.number().int().min(0).max(1_000_000).optional(),
    subagentCount: z.number().int().min(0).max(100_000).optional(),
    permissionMode: z.string().max(64).optional(),
    exitCodeCategory: z.string().max(64).optional(),
    operatingSystem: z.string().max(32).optional(),
    changedFileCountBucket: z.string().max(32).optional(),
  })
  .strict();
export type CanonicalAgentMetadata = z.infer<typeof canonicalAgentMetadataSchema>;

export const agentLifecycleEventSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PROTOCOL_VERSION),
    eventId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(256),
    environmentKind: z.enum(AGENT_ENVIRONMENT_KINDS),
    environmentId: z.string().min(1).max(128),
    installationId: z.string().min(16).max(256),
    deviceId: z.string().uuid().optional(),
    provider: z.enum(AGENT_PROVIDERS),
    integrationMode: z.enum(AGENT_INTEGRATION_MODES),
    providerSessionHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    providerTurnHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    providerTaskHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    workspaceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    eventType: z.enum(AGENT_EVENT_TYPES),
    sourceType: z.enum(AGENT_EVENT_SOURCE_TYPES),
    confidence: z.number().min(0).max(1),
    occurredAt: z.string().datetime({ offset: true }),
    monotonicOffsetMs: z.number().int().min(0).max(86_400_000).optional(),
    sequence: z.number().int().min(0).max(10_000_000).optional(),
    correlationId: z.string().min(1).max(256),
    causationId: z.string().min(1).max(256).optional(),
    parentCorrelationId: z.string().min(1).max(256).optional(),
    adapterVersion: z.string().min(1).max(64),
    clientVersion: z.string().min(1).max(64),
    providerVersion: z.string().max(64).optional(),
    metadata: canonicalAgentMetadataSchema,
  })
  .strict();
export type AgentLifecycleEventV1 = z.infer<typeof agentLifecycleEventSchema>;

export const agentLifecycleBatchSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PROTOCOL_VERSION),
    environmentId: z.string().min(1).max(128),
    installationId: z.string().min(16).max(256),
    deviceId: z.string().uuid(),
    events: z.array(agentLifecycleEventSchema).min(1).max(100),
  })
  .strict();
export type AgentLifecycleBatchV1 = z.infer<typeof agentLifecycleBatchSchema>;

/**
 * Build the exact envelope that clients and the API sign. Event ordering is
 * deterministic so offline queues can replay a batch without depending on
 * append order. Invalid provider payloads must never be passed to this helper;
 * callers should first normalize them into AgentLifecycleEventV1 values.
 */
export function canonicalAgentBatchPayload(
  batch: Pick<
    AgentLifecycleBatchV1,
    'schemaVersion' | 'environmentId' | 'installationId' | 'deviceId' | 'events'
  >,
): Record<string, unknown> {
  return canonicalAgentBatchPayloadFromUnknown(batch);
}

/**
 * Canonicalize the raw request envelope before schema validation. This lets the
 * API authenticate a mixed batch and then return per-event validation
 * acknowledgements instead of rejecting the entire batch because one event is
 * malformed. Clients should prefer canonicalAgentBatchPayload for typed data;
 * this companion exists for the server's defensive boundary only.
 */
export function canonicalAgentBatchPayloadFromUnknown(batch: {
  schemaVersion: number;
  environmentId: string;
  installationId: string;
  deviceId: string;
  events: unknown[];
}): Record<string, unknown> {
  return {
    schemaVersion: batch.schemaVersion,
    environmentId: batch.environmentId,
    installationId: batch.installationId,
    deviceId: batch.deviceId,
    events: [...batch.events].sort(compareUnknownAgentEvents),
  };
}

function compareUnknownAgentEvents(left: unknown, right: unknown): number {
  const leftRecord = left && typeof left === 'object' ? (left as Record<string, unknown>) : {};
  const rightRecord = right && typeof right === 'object' ? (right as Record<string, unknown>) : {};
  const parsedLeftTime =
    typeof leftRecord.occurredAt === 'string' ? Date.parse(leftRecord.occurredAt) : Number.NaN;
  const parsedRightTime =
    typeof rightRecord.occurredAt === 'string' ? Date.parse(rightRecord.occurredAt) : Number.NaN;
  const leftTime = Number.isFinite(parsedLeftTime) ? parsedLeftTime : Number.MAX_SAFE_INTEGER;
  const rightTime = Number.isFinite(parsedRightTime) ? parsedRightTime : Number.MAX_SAFE_INTEGER;
  const timeComparison = compareNumbers(leftTime, rightTime);
  if (timeComparison !== 0) return timeComparison;

  const leftSequence =
    typeof leftRecord.sequence === 'number' && Number.isFinite(leftRecord.sequence)
      ? leftRecord.sequence
      : Number.MAX_SAFE_INTEGER;
  const rightSequence =
    typeof rightRecord.sequence === 'number' && Number.isFinite(rightRecord.sequence)
      ? rightRecord.sequence
      : Number.MAX_SAFE_INTEGER;
  const sequenceComparison = compareNumbers(leftSequence, rightSequence);
  if (sequenceComparison !== 0) return sequenceComparison;

  const leftId = typeof leftRecord.eventId === 'string' ? leftRecord.eventId : '';
  const rightId = typeof rightRecord.eventId === 'string' ? rightRecord.eventId : '';
  const idComparison = compareStrings(leftId, rightId);
  if (idComparison !== 0) return idComparison;
  return compareStrings(stableSerialize(left), stableSerialize(right));
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'number:invalid';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'undefined') return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return typeof value;
}

/**
 * Keys and values that are never permitted to reach canonical metadata or the
 * API. This is intentionally an allowlist sanitizer: provider payloads are
 * not copied wholesale and unknown fields are discarded.
 */
export const FORBIDDEN_AGENT_FIELD_NAMES = [
  'prompt',
  'response',
  'assistant_message',
  'reasoning',
  'command',
  'command_args',
  'arguments',
  'terminal_output',
  'tool_input',
  'tool_output',
  'file_path',
  'file_name',
  'source_code',
  'transcript_path',
  'repository_url',
  'environment_variables',
  'api_key',
  'token',
  'cwd',
  'working_directory',
  'username',
  'hostname',
] as const;

const forbiddenNameSet = new Set(FORBIDDEN_AGENT_FIELD_NAMES);

function normalizeFieldName(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const sensitiveValuePatterns = [
  /-----BEGIN [A-Z ]+-----/i,
  /\b(?:sk|pk|rk|api|token|secret)[_-][A-Za-z0-9_-]{8,}\b/i,
  /\b(?:password|passwd)\s*[:=]/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:^|[\\/])(?:home|Users|private|workspace)(?:[\\/]|$)/i,
];

export type SanitizedHookPayload = {
  provider: AgentProvider;
  providerEvent: string;
  metadata: CanonicalAgentMetadata;
};

const MAX_HOOK_PAYLOAD_DEPTH = 8;
const MAX_HOOK_PAYLOAD_NODES = 1_000;
const MAX_HOOK_STRING_LENGTH = 16_384;

function assertSafePayloadShape(value: unknown, depth = 0, state = { nodes: 0 }): void {
  state.nodes += 1;
  if (state.nodes > MAX_HOOK_PAYLOAD_NODES) {
    throw new Error('Hook payload is too complex');
  }
  if (typeof value === 'string') {
    if (value.length > MAX_HOOK_STRING_LENGTH)
      throw new Error('Hook payload contains an oversized string');
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (depth >= MAX_HOOK_PAYLOAD_DEPTH) throw new Error('Hook payload is too deeply nested');
  if (Array.isArray(value)) {
    for (const child of value) assertSafePayloadShape(child, depth + 1, state);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.length > 128) throw new Error('Hook payload contains an oversized field name');
    assertSafePayloadShape(child, depth + 1, state);
  }
}

function hasForbiddenContent(value: unknown): boolean {
  if (typeof value === 'string')
    return sensitiveValuePatterns.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(hasForbiddenContent);
  if (value && typeof value === 'object')
    return Object.entries(value).some(([key, child]) => {
      const normalized = normalizeFieldName(key);
      return (
        forbiddenNameSet.has(normalized as (typeof FORBIDDEN_AGENT_FIELD_NAMES)[number]) ||
        hasForbiddenContent(child)
      );
    });
  return false;
}

function readSafeMetadata(input: Record<string, unknown>): CanonicalAgentMetadata {
  const result: Record<string, string | boolean | number> = {};
  for (const key of CANONICAL_METADATA_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.length <= 128) result[key] = value;
    else if (typeof value === 'boolean') result[key] = value;
    else if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 1_000_000
    )
      result[key] = value;
  }
  return canonicalAgentMetadataSchema.parse(result);
}

/** Normalize a raw provider-shaped hook payload without retaining raw input. */
export function sanitizeHookPayload(
  provider: AgentProvider,
  providerEvent: string,
  input: unknown,
): SanitizedHookPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Hook payload must be an object');
  }
  const normalizedProviderEvent = providerEvent.trim();
  if (!normalizedProviderEvent || normalizedProviderEvent.length > 64) {
    throw new Error('Hook provider event must be between 1 and 64 characters');
  }
  assertSafePayloadShape(input);
  const record = input as Record<string, unknown>;
  if (hasForbiddenContent(record)) throw new Error('Hook payload contains forbidden privacy data');
  return {
    provider,
    providerEvent: normalizedProviderEvent,
    metadata: readSafeMetadata(record),
  };
}

/** Return whether a client event falls inside the protocol's offline window. */
export function isAgentEventTimestampBounded(occurredAt: string, nowMs = Date.now()): boolean {
  const timestampMs = Date.parse(occurredAt);
  if (!Number.isFinite(timestampMs)) return false;
  return (
    timestampMs >= nowMs - AGENT_EVENT_MAX_AGE_MS &&
    timestampMs <= nowMs + AGENT_EVENT_MAX_FUTURE_MS
  );
}

export type ProviderFixture = {
  id: string;
  provider: AgentProvider;
  providerEvent: string;
  payload: Record<string, unknown>;
};

export function normalizeFixture(fixture: ProviderFixture): SanitizedHookPayload {
  return sanitizeHookPayload(fixture.provider, fixture.providerEvent, fixture.payload);
}

export {
  assignShadowPolicyToSession,
  ATTENTION_PPM_SCALE,
  type AttentionPolicyStatus,
  attentionPolicyStatusSchema,
  type AttentionState,
  attentionStateSchema,
  evaluateShadowAttention,
  type ShadowAttentionEvaluationInput,
  type ShadowAttentionMeasurement,
  shadowAttentionMeasurementSchema,
  type ShadowAttentionPolicy,
  shadowAttentionPolicySchema,
  type ShadowPolicyRecord,
  shadowPolicyRecordSchema,
  type ShadowSessionPolicyAssignment,
} from './attention-contract';
export type { GoldenAgentFixture } from './golden-fixtures';
export {
  AGENT_GOLDEN_FIXTURES,
  goldenFixtureProviders,
  loadGoldenAgentFixtures,
} from './golden-fixtures';
export {
  type AttentionDatasetManifest,
  attentionDatasetManifestSchema,
  type AttentionExperimentAssignment,
  attentionExperimentAssignmentSchema,
  type AttentionExperimentDefinition,
  attentionExperimentDefinitionSchema,
  type AttentionExperimentStatus,
  attentionExperimentStatusSchema,
  type AttentionExperimentVariant,
  attentionExperimentVariantSchema,
  type AttentionModelArtifact,
  attentionModelArtifactSchema,
} from './model-contract';
export {
  createShadowSessionFact,
  type ShadowAttestationStatus,
  shadowAttestationStatusSchema,
  type ShadowFraudRiskStatus,
  shadowFraudRiskStatusSchema,
  type ShadowSessionFact,
  shadowSessionFactSchema,
} from './shadow-fact-contract';

export function scanForbiddenAgentFields(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      if (sensitiveValuePatterns.some((pattern) => pattern.test(candidate))) {
        found.add('<sensitive-value>');
      }
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    for (const [key, child] of Object.entries(candidate)) {
      const normalized = normalizeFieldName(key);
      if (forbiddenNameSet.has(normalized as (typeof FORBIDDEN_AGENT_FIELD_NAMES)[number]))
        found.add(normalized);
      visit(child);
    }
  };
  visit(value);
  return [...found].sort();
}
