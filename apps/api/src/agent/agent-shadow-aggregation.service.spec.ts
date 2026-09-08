import { describe, expect, it } from 'vitest';

import { AgentShadowAggregationService } from './agent-shadow-aggregation.service';

describe('AgentShadowAggregationService', () => {
  it('computes rendered, viewable, eligible, and qualified durations', () => {
    const service = new AgentShadowAggregationService();
    const result = service.aggregate(
      [
        { atMs: 0, state: 'not_viewable' },
        { atMs: 1_000, state: 'ai_processing' },
        { atMs: 5_000, state: 'user_input_required' },
      ],
      [
        { atMs: 0, state: 'not_viewable' },
        { atMs: 2_000, state: 'foreground_visible' },
        { atMs: 4_000, state: 'background' },
      ],
      6_000,
    );

    expect(result).toMatchObject({
      renderedMs: 2_000,
      viewableMs: 2_000,
      aiEligibleMs: 4_000,
      qualifiedMs: 2_000,
      financialSideEffects: false,
    });
    expect(result.qualifiedIntervals).toEqual([
      { startMs: 2_000, endMs: 4_000, state: 'ai_processing' },
    ]);
  });

  it('maps canonical events without treating user-required states as eligible', () => {
    const service = new AgentShadowAggregationService();
    const result = service.aggregateCanonicalEvents(
      [
        {
          schemaVersion: 1,
          eventId: '11111111-1111-4111-8111-111111111111',
          idempotencyKey: 'event-1',
          environmentKind: 'sandbox',
          environmentId: 'sandbox-1',
          installationId: 'installation-123456789',
          provider: 'claude_code',
          integrationMode: 'native_hook',
          eventType: 'turn.processing_started',
          sourceType: 'inferred',
          confidence: 0.8,
          occurredAt: '1970-01-01T00:00:01.000Z',
          correlationId: 'correlation-1',
          adapterVersion: '0.0.1',
          clientVersion: '0.0.1',
          metadata: {},
        },
        {
          schemaVersion: 1,
          eventId: '22222222-2222-4222-8222-222222222222',
          idempotencyKey: 'event-2',
          environmentKind: 'sandbox',
          environmentId: 'sandbox-1',
          installationId: 'installation-123456789',
          provider: 'claude_code',
          integrationMode: 'native_hook',
          eventType: 'input.required',
          sourceType: 'inferred',
          confidence: 0.8,
          occurredAt: '1970-01-01T00:00:03.000Z',
          correlationId: 'correlation-1',
          adapterVersion: '0.0.1',
          clientVersion: '0.0.1',
          metadata: {},
        },
      ],
      [{ atMs: 0, state: 'foreground_visible' }],
      4_000,
    );

    expect(result.aiEligibleMs).toBe(2_000);
    expect(result.qualifiedMs).toBe(2_000);
    expect(JSON.stringify(result)).not.toContain('ledger');
    expect(JSON.stringify(result)).not.toContain('reward');
  });

  it('keeps headless execution out of human-attention intervals', () => {
    const service = new AgentShadowAggregationService();
    const result = service.aggregateCanonicalEvents(
      [
        {
          schemaVersion: 1,
          eventId: '33333333-3333-4333-8333-333333333333',
          idempotencyKey: 'headless-event-1',
          environmentKind: 'test',
          environmentId: 'test-1',
          installationId: 'installation-123456789',
          provider: 'claude_code',
          integrationMode: 'native_hook',
          eventType: 'turn.processing_started',
          sourceType: 'observed',
          confidence: 1,
          occurredAt: '1970-01-01T00:00:01.000Z',
          correlationId: 'headless-correlation',
          adapterVersion: '0.0.1',
          clientVersion: '0.0.1',
          metadata: { executionContext: 'headless' },
        },
      ],
      [{ atMs: 0, state: 'foreground_visible' }],
      4_000,
    );

    expect(result.aiEligibleMs).toBe(0);
    expect(result.qualifiedMs).toBe(0);
    expect(result.financialSideEffects).toBe(false);
  });

  it('reconciles canonical events in total order when delivery is out of order', () => {
    const service = new AgentShadowAggregationService();
    const ordered = [
      {
        schemaVersion: 1 as const,
        eventId: '44444444-4444-4444-8444-444444444444',
        idempotencyKey: 'ordered-1',
        environmentKind: 'test' as const,
        environmentId: 'test-1',
        installationId: 'installation-123456789',
        provider: 'claude_code' as const,
        integrationMode: 'native_hook' as const,
        eventType: 'turn.processing_started' as const,
        sourceType: 'observed' as const,
        confidence: 1,
        occurredAt: '1970-01-01T00:00:01.000Z',
        sequence: 1,
        correlationId: 'ordered-correlation',
        adapterVersion: '0.0.1',
        clientVersion: '0.0.1',
        metadata: {},
      },
      {
        schemaVersion: 1 as const,
        eventId: '55555555-5555-4555-8555-555555555555',
        idempotencyKey: 'ordered-2',
        environmentKind: 'test' as const,
        environmentId: 'test-1',
        installationId: 'installation-123456789',
        provider: 'claude_code' as const,
        integrationMode: 'native_hook' as const,
        eventType: 'input.required' as const,
        sourceType: 'observed' as const,
        confidence: 1,
        occurredAt: '1970-01-01T00:00:03.000Z',
        sequence: 2,
        correlationId: 'ordered-correlation',
        adapterVersion: '0.0.1',
        clientVersion: '0.0.1',
        metadata: {},
      },
    ];
    const visible = [
      { atMs: 0, state: 'foreground_visible' as const },
      { atMs: 4_000, state: 'background' as const },
    ];
    const first = service.aggregateCanonicalEvents(ordered, visible, 4_000);
    const second = service.aggregateCanonicalEvents(
      [...ordered].reverse(),
      [...visible].reverse(),
      4_000,
    );
    expect(second).toEqual(first);
  });
});
