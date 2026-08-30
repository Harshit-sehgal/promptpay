import type {
  AgentEventSourceType,
  AgentEventType,
  AgentIntegrationMode,
} from '@ateva/agent-protocol';

import { classifyProviderEvent, type ProviderLifecycleState } from './provider-state';

const PPM_SCALE = 1_000_000;

export type LifecycleConformanceEvent = {
  /** A local fixture identifier; it is not provider content. */
  eventId: string;
  /** Kept as string so an unsupported provider event can be measured as unknown. */
  eventType: string;
  sourceType?: AgentEventSourceType;
  integrationMode?: AgentIntegrationMode;
  occurredAtMs?: number;
  durationMs?: number;
};

export type LifecycleConformanceScenario = {
  id: string;
  expectedEventTypes: readonly string[];
  expectedStates: readonly ProviderLifecycleState[];
  events: readonly LifecycleConformanceEvent[];
  expectedDurationMs?: number;
};

export type LifecycleConformanceReport = {
  scenarioId: string;
  eventCount: number;
  knownStatePpm: number;
  inferredStatePpm: number;
  providerBackedStatePpm: number;
  missingEventRatePpm: number;
  duplicateEventRatePpm: number;
  incorrectTransitionRatePpm: number;
  durationReconciliationErrorMs: number;
  passed: boolean;
  financialSideEffects: false;
};

export type LifecycleConformanceSuiteReport = {
  reports: readonly LifecycleConformanceReport[];
  passed: boolean;
  financialSideEffects: false;
};

/**
 * Measure a provider adapter against an explicit scenario. This is a test and
 * diagnostics boundary: it classifies event names, never interprets payloads,
 * and produces no network, ledger, reward, or settlement side effect.
 */
export function evaluateLifecycleConformance(
  scenario: LifecycleConformanceScenario,
): LifecycleConformanceReport {
  if (!scenario.id || scenario.id.length > 128)
    throw new Error('scenario id is required and bounded');

  const events = scenario.events;
  const actualStates = events.map((event) => classifyEvent(event.eventType));
  const knownCount = actualStates.filter((state) => state !== 'unknown').length;
  const inferredCount = events.filter((event) => event.sourceType === 'inferred').length;
  const providerBackedCount = events.filter(
    (event) =>
      (event.integrationMode === 'native_hook' || event.integrationMode === 'native_plugin') &&
      (event.sourceType === 'observed' || event.sourceType === 'derived'),
  ).length;
  const duplicateCount = duplicateEventCount(events);
  const missingCount = missingEventCount(scenario.expectedEventTypes, events);
  const transitionDenominator = Math.max(scenario.expectedStates.length, actualStates.length);
  const incorrectTransitions = transitionDenominator
    ? countStateMismatches(scenario.expectedStates, actualStates)
    : 0;
  const durationReconciliationErrorMs =
    scenario.expectedDurationMs === undefined
      ? 0
      : Math.abs(scenario.expectedDurationMs - observedDurationMs(events));

  const report: LifecycleConformanceReport = {
    scenarioId: scenario.id,
    eventCount: events.length,
    knownStatePpm: ratioPpm(knownCount, events.length),
    inferredStatePpm: ratioPpm(inferredCount, events.length),
    providerBackedStatePpm: ratioPpm(providerBackedCount, events.length),
    missingEventRatePpm: ratioPpm(missingCount, scenario.expectedEventTypes.length),
    duplicateEventRatePpm: ratioPpm(duplicateCount, events.length),
    incorrectTransitionRatePpm: ratioPpm(incorrectTransitions, transitionDenominator),
    durationReconciliationErrorMs,
    passed:
      missingCount === 0 &&
      duplicateCount === 0 &&
      incorrectTransitions === 0 &&
      actualStates.every((state) => state !== 'unknown') &&
      durationReconciliationErrorMs === 0,
    financialSideEffects: false,
  };
  return report;
}

export function runLifecycleConformanceSuite(
  scenarios: readonly LifecycleConformanceScenario[],
): LifecycleConformanceSuiteReport {
  const reports = scenarios.map(evaluateLifecycleConformance);
  return {
    reports,
    passed: reports.every((report) => report.passed),
    financialSideEffects: false,
  };
}

function classifyEvent(eventType: string): ProviderLifecycleState {
  // The protocol classifier is intentionally the only source of state. An
  // unknown string is cast only at this boundary so it remains `unknown`.
  return classifyProviderEvent(eventType as AgentEventType);
}

function ratioPpm(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.floor((numerator * PPM_SCALE) / denominator);
}

function missingEventCount(
  expectedEventTypes: readonly string[],
  events: readonly LifecycleConformanceEvent[],
): number {
  const actualCounts = new Map<string, number>();
  for (const event of events)
    actualCounts.set(event.eventType, (actualCounts.get(event.eventType) ?? 0) + 1);
  let missing = 0;
  for (const expected of expectedEventTypes) {
    const count = actualCounts.get(expected) ?? 0;
    if (count > 0) actualCounts.set(expected, count - 1);
    else missing++;
  }
  return missing;
}

function duplicateEventCount(events: readonly LifecycleConformanceEvent[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const event of events) {
    if (seen.has(event.eventId)) duplicates++;
    else seen.add(event.eventId);
  }
  return duplicates;
}

function countStateMismatches(
  expected: readonly ProviderLifecycleState[],
  actual: readonly ProviderLifecycleState[],
): number {
  const length = Math.max(expected.length, actual.length);
  let mismatches = 0;
  for (let index = 0; index < length; index++) {
    if (expected[index] !== actual[index]) mismatches++;
  }
  return mismatches;
}

function observedDurationMs(events: readonly LifecycleConformanceEvent[]): number {
  const explicitDurations: number[] = [];
  for (const event of events) {
    if (
      event.durationMs !== undefined &&
      Number.isInteger(event.durationMs) &&
      event.durationMs >= 0
    ) {
      explicitDurations.push(event.durationMs);
    }
  }
  if (explicitDurations.length > 0) {
    return explicitDurations.reduce((total, duration) => total + duration, 0);
  }
  const timestamps = events
    .map((event) => event.occurredAtMs)
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp));
  if (timestamps.length < 2) return 0;
  return Math.max(...timestamps) - Math.min(...timestamps);
}
