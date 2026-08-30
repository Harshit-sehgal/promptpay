import { createHash, createHmac } from 'node:crypto';

import {
  AgentLifecycleEventV1,
  ATTENTION_PPM_SCALE,
  createShadowSessionFact,
  evaluateShadowAttention,
  ShadowAttentionMeasurement,
  ShadowAttentionPolicy,
  ShadowSessionFact,
} from '@ateva/agent-protocol';

import {
  AgentShadowAggregationService,
  viewabilityEventsForCanonicalEvents,
} from './agent-shadow-aggregation.service';

export const SHADOW_FACT_CALCULATION_VERSION = 'attention-shadow-fact-v1';

export type ShadowHypotheticalEconomics = {
  currency: string;
  advertiserChargeMinor: bigint;
  userRewardMinor: bigint;
  platformContributionMinor: bigint;
  calculationVersion: string;
};

export type ShadowSessionFactInput = {
  sessionId: string;
  userId: string;
  deviceId: string;
  pseudonymKey: string;
  environmentKind: ShadowSessionFact['environmentKind'];
  environmentId: string;
  provider: string;
  integrationMode: string;
  events: readonly AgentLifecycleEventV1[];
  policy: ShadowAttentionPolicy;
  startedAt?: Date | string;
  endedAt: Date | string;
  observedAt?: Date | string;
  recordedAt?: Date | string;
  hypotheticalEconomics?: ShadowHypotheticalEconomics | null;
  aggregator?: AgentShadowAggregationService;
};

export type ShadowSessionFactBuildResult = {
  fact: ShadowSessionFact;
  measurement: ShadowAttentionMeasurement;
  financialSideEffects: false;
};

/**
 * Build the durable, privacy-safe projection for one completed session.
 *
 * The input contains raw user/device IDs only so this function can derive
 * keyed digests. They are never copied into the returned fact. Provider event
 * metadata has already crossed the canonical protocol sanitizer at the API
 * boundary; this function still selects only coarse fields from it.
 */
export function buildShadowSessionFact(
  input: ShadowSessionFactInput,
): ShadowSessionFactBuildResult {
  if (!input.sessionId || !input.userId || !input.deviceId || !input.pseudonymKey) {
    throw new Error('session, user, device, and pseudonym identities are required');
  }
  if (input.events.length === 0) throw new Error('a session fact requires at least one event');

  const policy = input.policy;
  const endedAt = parseDate(input.endedAt, 'endedAt');
  const orderedEvents = [...input.events].sort(compareEvents);
  const firstEventAt = parseDate(orderedEvents[0].occurredAt, 'event timestamp');
  const startedAt = input.startedAt ? parseDate(input.startedAt, 'startedAt') : firstEventAt;
  if (endedAt.getTime() < startedAt.getTime()) {
    throw new Error('endedAt cannot precede startedAt');
  }

  const endMs = endedAt.getTime();
  const aggregator = input.aggregator ?? new AgentShadowAggregationService();
  const aggregate = aggregator.aggregateCanonicalEvents(
    orderedEvents,
    viewabilityEventsForCanonicalEvents(orderedEvents),
    endMs,
  );
  const measurement = evaluateShadowAttention(
    {
      renderedMs: aggregate.renderedMs,
      viewableMs: aggregate.viewableMs,
      aiEligibleMs: aggregate.aiEligibleMs,
      qualifiedMs: aggregate.qualifiedMs,
    },
    policy,
  );

  const observedAt = input.observedAt ? parseDate(input.observedAt, 'observedAt') : endedAt;
  const recordedAt = input.recordedAt ? parseDate(input.recordedAt, 'recordedAt') : observedAt;
  const providerClass = normalizeDimension(input.provider);
  const integrationMode = normalizeDimension(input.integrationMode);
  const toolClass = dominantToolClass(orderedEvents);
  const hypothetical = input.hypotheticalEconomics ?? null;
  const factWithoutDigest: Omit<ShadowSessionFact, 'recordDigest' | 'datasetVersion'> = {
    sessionKey: keyedDigest(input.pseudonymKey, input.sessionId),
    userKey: keyedDigest(input.pseudonymKey, input.userId),
    deviceKey: keyedDigest(input.pseudonymKey, input.deviceId),
    observedAt: observedAt.toISOString(),
    sessionStartedAt: startedAt.toISOString(),
    sessionEndedAt: endedAt.toISOString(),
    environmentKind: input.environmentKind,
    environmentId: boundedEnvironmentId(input.environmentId),
    providerClass,
    integrationMode,
    toolClass,
    policyVersion: policy.version,
    alphaPpm: policy.alphaPpm,
    passiveCapRatioPpm: policy.passiveCapRatioPpm,
    passiveSessionCapMs: policy.passiveSessionCapMs,
    minimumQualifiedMs: policy.minimumQualifiedMs,
    renderedMs: measurement.renderedMs,
    viewableMs: measurement.viewableMs,
    aiEligibleMs: measurement.aiEligibleMs,
    qualifiedMs: measurement.qualifiedMs,
    passiveMs: measurement.passiveMs,
    passiveBillableMs: measurement.passiveBillableMs,
    weightedBillablePpmMs: measurement.weightedBillablePpmMs,
    attestationStatus: 'unverified',
    classificationConfidencePpm: minimumConfidencePpm(orderedEvents),
    fraudRiskStatus: 'unknown',
    unknownEventRatePpm: unknownEventRatePpm(orderedEvents),
    hypotheticalCurrency: hypothetical?.currency ?? null,
    hypotheticalAdvertiserChargeMinor: hypothetical?.advertiserChargeMinor ?? null,
    hypotheticalUserRewardMinor: hypothetical?.userRewardMinor ?? null,
    hypotheticalPlatformContributionMinor: hypothetical?.platformContributionMinor ?? null,
    economicCalculationVersion: hypothetical?.calculationVersion ?? null,
    calculationVersion: SHADOW_FACT_CALCULATION_VERSION,
    recordedAt: recordedAt.toISOString(),
  };

  const recordDigest = shadowSessionFactDigest({ datasetVersion: 1, ...factWithoutDigest });
  const fact = createShadowSessionFact({ ...factWithoutDigest, recordDigest });
  return { fact, measurement, financialSideEffects: false };
}

/** Recompute the digest over the complete privacy-safe fact, excluding only the digest itself. */
export function shadowSessionFactDigest(fact: Omit<ShadowSessionFact, 'recordDigest'>): string {
  const { recordDigest: _ignored, ...digestable } = fact as ShadowSessionFact;
  return sha256(stableSerialize(digestable));
}

export function keyedDigest(key: string, value: string): string {
  if (!key || !value) throw new Error('key and value are required for pseudonymization');
  return createHmac('sha256', key).update(value).digest('hex');
}

function dominantToolClass(events: readonly AgentLifecycleEventV1[]): string | null {
  const counts = new Map<string, number>();
  for (const event of events) {
    const toolFamily = event.metadata.toolFamily;
    if (!toolFamily) continue;
    counts.set(toolFamily, (counts.get(toolFamily) ?? 0) + 1);
  }
  let winner: string | null = null;
  let count = 0;
  for (const [toolFamily, value] of counts) {
    if (value > count || (value === count && toolFamily < (winner ?? toolFamily))) {
      winner = toolFamily;
      count = value;
    }
  }
  return winner ? normalizeDimension(winner) : null;
}

function minimumConfidencePpm(events: readonly AgentLifecycleEventV1[]): bigint {
  const minimum = events.reduce((value, event) => Math.min(value, event.confidence), 1);
  return BigInt(
    Math.max(0, Math.min(Number(ATTENTION_PPM_SCALE), Math.floor(minimum * 1_000_000))),
  );
}

function unknownEventRatePpm(events: readonly AgentLifecycleEventV1[]): bigint {
  const providerEvents = events.filter((event) => isProviderLifecycleEvent(event.eventType));
  if (providerEvents.length === 0) return 0n;
  const unknown = providerEvents.filter((event) => !isKnownProviderEvent(event.eventType)).length;
  return (BigInt(unknown) * ATTENTION_PPM_SCALE) / BigInt(providerEvents.length);
}

function isProviderLifecycleEvent(eventType: AgentLifecycleEventV1['eventType']): boolean {
  return (
    eventType.startsWith('session.') ||
    eventType.startsWith('turn.') ||
    eventType.startsWith('tool.') ||
    eventType.startsWith('input.') ||
    eventType.startsWith('permission.') ||
    eventType.startsWith('subagent.') ||
    eventType.startsWith('task.') ||
    eventType === 'event.rejected'
  );
}

function isKnownProviderEvent(eventType: AgentLifecycleEventV1['eventType']): boolean {
  return eventType !== 'event.rejected';
}

function parseDate(value: Date | string, name: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be a valid date`);
  return date;
}

function compareEvents(left: AgentLifecycleEventV1, right: AgentLifecycleEventV1): number {
  const occurredAt = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  if (occurredAt !== 0) return occurredAt;
  const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  return left.eventId.localeCompare(right.eventId);
}

function normalizeDimension(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error('dimension must be a bounded identifier');
  }
  return normalized;
}

function boundedEnvironmentId(value: string): string {
  if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(value)) {
    throw new Error('environmentId must be a bounded opaque identifier');
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableSerialize(value: unknown): string {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return 'undefined';
}
