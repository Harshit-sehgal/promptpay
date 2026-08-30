import { createHmac } from 'node:crypto';

import type { ShadowAttentionPolicy } from '@ateva/agent-protocol';

import {
  AgentShadowAggregationService,
  ViewabilityIntervalEvent,
} from './agent-shadow-aggregation.service';
import { AttentionIntervalEvent } from './attention-interval-aggregator';
import { compareShadowPolicies } from './attention-shadow-economics';
import { createShadowFeatureRecord, ShadowFeatureRecord } from './attention-shadow-feature';

export type ShadowDatasetInput = {
  sessionId: string;
  pseudonymKey: string;
  environmentKind: ShadowFeatureRecord['environmentKind'];
  providerClass: string;
  integrationMode: string;
  experimentVariant?: string | null;
  providerEvents: readonly AttentionIntervalEvent[];
  viewabilityEvents: readonly ViewabilityIntervalEvent[];
  endMs: number;
};

export type ShadowDatasetResult = {
  record: ShadowFeatureRecord;
  policyComparisons: ReturnType<typeof compareShadowPolicies>;
  financialSideEffects: false;
};

/** Build a deterministic, non-financial dataset row from telemetry only. */
export function buildShadowDatasetRow(
  input: ShadowDatasetInput,
  currentPolicy: ShadowAttentionPolicy,
  candidatePolicies: readonly ShadowAttentionPolicy[] = [],
  aggregator = new AgentShadowAggregationService(),
): ShadowDatasetResult {
  const aggregate = aggregator.aggregate(
    input.providerEvents,
    input.viewabilityEvents,
    input.endMs,
  );
  const record = createShadowFeatureRecord({
    sessionKey: pseudonymizeSession(input.sessionId, input.pseudonymKey),
    environmentKind: input.environmentKind,
    policyVersion: currentPolicy.version,
    experimentVariant: input.experimentVariant ?? null,
    providerClass: normalizeDimension(input.providerClass),
    integrationMode: normalizeDimension(input.integrationMode),
    renderedMs: aggregate.renderedMs,
    viewableMs: aggregate.viewableMs,
    aiEligibleMs: aggregate.aiEligibleMs,
    qualifiedMs: aggregate.qualifiedMs,
    passiveMs: Math.max(aggregate.viewableMs - aggregate.qualifiedMs, 0),
    passiveBillableMs: 0,
    weightedBillablePpmMs: 0n,
  });
  const policyComparisons = compareShadowPolicies(
    {
      renderedMs: record.renderedMs,
      viewableMs: record.viewableMs,
      aiEligibleMs: record.aiEligibleMs,
    },
    currentPolicy,
    candidatePolicies,
  );
  return { record, policyComparisons, financialSideEffects: false };
}

function pseudonymizeSession(sessionId: string, key: string): string {
  if (!sessionId || !key) throw new Error('sessionId and pseudonymKey are required');
  return createHmac('sha256', key).update(sessionId).digest('hex');
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
