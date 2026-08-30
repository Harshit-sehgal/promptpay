import { describe, expect, it } from 'vitest';

import {
  evaluateLifecycleConformance,
  runLifecycleConformanceSuite,
} from './lifecycle-conformance';
import { CLAUDE_CODE_CONFORMANCE_FIXTURES } from './lifecycle-conformance-fixtures';

const baseEvents = [
  {
    eventId: 'turn-1',
    eventType: 'turn.submitted',
    sourceType: 'observed' as const,
    integrationMode: 'native_hook' as const,
    occurredAtMs: 0,
  },
  {
    eventId: 'turn-2',
    eventType: 'turn.processing_started',
    sourceType: 'observed' as const,
    integrationMode: 'native_hook' as const,
    occurredAtMs: 1_000,
  },
  {
    eventId: 'turn-3',
    eventType: 'input.required',
    sourceType: 'observed' as const,
    integrationMode: 'native_hook' as const,
    occurredAtMs: 4_000,
  },
];

describe('provider lifecycle conformance', () => {
  it('reports a deterministic, provider-backed supported sequence', () => {
    const report = evaluateLifecycleConformance({
      id: 'claude-normal-turn',
      expectedEventTypes: baseEvents.map((event) => event.eventType),
      expectedStates: ['user_active', 'ai_processing', 'user_input_required'],
      events: baseEvents,
      expectedDurationMs: 4_000,
    });

    expect(report).toMatchObject({
      knownStatePpm: 1_000_000,
      providerBackedStatePpm: 1_000_000,
      missingEventRatePpm: 0,
      duplicateEventRatePpm: 0,
      incorrectTransitionRatePpm: 0,
      durationReconciliationErrorMs: 0,
      passed: true,
      financialSideEffects: false,
    });
  });

  it('counts unknown, missing, duplicate, and wrong transitions instead of guessing', () => {
    const report = evaluateLifecycleConformance({
      id: 'unsupported-provider-edge',
      expectedEventTypes: ['turn.processing_started', 'tool.started'],
      expectedStates: ['ai_processing', 'tool_processing'],
      events: [
        {
          eventId: 'same-id',
          eventType: 'turn.processing_started',
          sourceType: 'inferred',
          integrationMode: 'heuristic_shadow',
        },
        {
          eventId: 'same-id',
          eventType: 'provider.future_event',
          sourceType: 'inferred',
          integrationMode: 'heuristic_shadow',
        },
      ],
    });

    expect(report.knownStatePpm).toBe(500_000);
    expect(report.inferredStatePpm).toBe(1_000_000);
    expect(report.missingEventRatePpm).toBe(500_000);
    expect(report.duplicateEventRatePpm).toBe(500_000);
    expect(report.incorrectTransitionRatePpm).toBe(500_000);
    expect(report.passed).toBe(false);
    expect(report.financialSideEffects).toBe(false);
  });

  it('aggregates suite status without creating activation authority', () => {
    const suite = runLifecycleConformanceSuite([
      {
        id: 'one',
        expectedEventTypes: ['turn.processing_started'],
        expectedStates: ['ai_processing'],
        events: [baseEvents[1]],
      },
    ]);
    expect(suite.passed).toBe(true);
    expect(suite.reports).toHaveLength(1);
    expect(suite.financialSideEffects).toBe(false);
  });

  it('keeps the supported Claude fixture set deterministic', () => {
    const suite = runLifecycleConformanceSuite(CLAUDE_CODE_CONFORMANCE_FIXTURES);
    expect(suite.passed).toBe(true);
    expect(suite.reports).toHaveLength(5);
    expect(suite.reports.every((report) => report.providerBackedStatePpm === 1_000_000)).toBe(true);
  });
});
