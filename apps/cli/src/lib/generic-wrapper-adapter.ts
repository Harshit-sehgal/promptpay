import { createHash } from 'node:crypto';

import {
  AGENT_ADAPTER_VERSION,
  AgentEventType,
  AgentLifecycleEventV1,
} from '@ateva/agent-protocol';

import { isHeadlessEnvironment } from './presentation-context';

export const GENERIC_WRAPPER_ADAPTER_VERSION = 'generic-wrapper-0.0.1';

type WrapperEventInput = {
  installationId: string;
  deviceId: string;
  correlationId: string;
  executable: string;
  eventType: Extract<AgentEventType, 'session.started' | 'turn.cancelled' | 'session.ended'>;
  occurredAt?: Date;
  durationMs?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

/**
 * Normalize one supervised-process lifecycle observation into a canonical
 * wrapper event. Only a coarse executable family and bounded outcome buckets
 * leave the device; the executable path and all command arguments are
 * intentionally absent.
 */
export function createGenericWrapperEvent(input: WrapperEventInput): AgentLifecycleEventV1 {
  const eventType = input.eventType;
  const occurredAt = input.occurredAt ?? new Date();
  const identity = `wrapper:${input.correlationId}:${eventType}`;
  const metadata: AgentLifecycleEventV1['metadata'] = {
    executableFamily: normalizeExecutableFamily(input.executable),
    ...(input.durationMs !== undefined
      ? { elapsedDurationBucket: durationBucket(input.durationMs) }
      : {}),
    ...(eventType === 'session.ended'
      ? {
          exitCodeCategory: exitCodeCategory(input.exitCode, input.signal),
          success: input.signal ? false : input.exitCode === 0,
        }
      : {}),
    ...(eventType === 'turn.cancelled' ? { exitCodeCategory: signalCategory(input.signal) } : {}),
  };

  return {
    schemaVersion: 1,
    eventId: deterministicEventUuid(identity),
    idempotencyKey: identity,
    environmentKind: resolveEnvironmentKind(),
    environmentId: process.env.ATEVA_ENVIRONMENT_ID ?? 'local',
    installationId: input.installationId,
    deviceId: input.deviceId,
    provider: 'generic_wrapper',
    integrationMode: 'wrapper',
    eventType,
    sourceType: 'inferred',
    confidence: 0.5,
    occurredAt: occurredAt.toISOString(),
    correlationId: input.correlationId,
    adapterVersion: GENERIC_WRAPPER_ADAPTER_VERSION,
    clientVersion: AGENT_ADAPTER_VERSION,
    // Stamped from this process's own environment. `ateva run -- <agent>` in a
    // CI job is legitimate agent work and is recorded as such, but it must not
    // become human-attention inventory.
    metadata: {
      ...metadata,
      executionContext: isHeadlessEnvironment() ? 'headless' : 'interactive',
    },
  };
}

export function normalizeExecutableFamily(executable: string): string {
  const basename =
    executable
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.toLowerCase()
      .replace(/\.(cmd|exe|bat|sh)$/i, '') ?? '';

  if (basename === 'claude' || basename === 'claude-code') return 'claude_code';
  if (basename === 'codex' || basename === 'codex-cli') return 'codex_cli';
  if (basename === 'aider') return 'aider';
  return 'other';
}

function durationBucket(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 1_000) return 'lt_1s';
  if (durationMs < 5_000) return '1_5s';
  if (durationMs < 30_000) return '5_30s';
  if (durationMs < 120_000) return '30_120s';
  return '120s_plus';
}

function exitCodeCategory(
  code: number | null | undefined,
  signal: NodeJS.Signals | null | undefined,
): string {
  if (signal) return signalCategory(signal);
  if (code === 0) return 'success';
  if (typeof code === 'number' && code > 0) return 'nonzero';
  return 'unknown';
}

function signalCategory(signal: NodeJS.Signals | null | undefined): string {
  if (signal === 'SIGINT') return 'signal_interrupt';
  if (signal === 'SIGTERM') return 'signal_terminate';
  return 'signal_other';
}

function deterministicEventUuid(identity: string): string {
  const hex = createHash('sha256').update(identity).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const compact = hex.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
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
