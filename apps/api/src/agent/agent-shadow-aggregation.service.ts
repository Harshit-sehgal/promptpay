import { Injectable } from '@nestjs/common';

import type { AgentLifecycleEventV1 } from '@ateva/agent-protocol';

import {
  aggregateAttentionIntervals,
  AttentionInterval,
  AttentionIntervalEvent,
  intersectIntervals,
} from './attention-interval-aggregator';

export type ViewabilityIntervalEvent = Omit<AttentionIntervalEvent, 'state'> & {
  /** Preserves canonical sequence for equal-timestamp observations. */
  order?: number;
  state:
    | 'foreground_visible'
    | 'foreground_not_visible'
    | 'background'
    | 'device_locked'
    | 'disconnected'
    | 'not_viewable';
};

export type ShadowAggregationResult = {
  providerIntervals: AttentionInterval[];
  viewabilityIntervals: AttentionInterval[];
  qualifiedIntervals: AttentionInterval[];
  renderedMs: number;
  viewableMs: number;
  aiEligibleMs: number;
  qualifiedMs: number;
  financialSideEffects: false;
};

/**
 * Reconstructs attention telemetry in memory. This service intentionally has
 * no Prisma or financial-domain dependency: callers may persist a separate
 * approved telemetry projection later, but this calculation cannot charge,
 * reward, reserve, or settle anything.
 */
@Injectable()
export class AgentShadowAggregationService {
  aggregate(
    providerEvents: readonly AttentionIntervalEvent[],
    viewabilityEvents: readonly ViewabilityIntervalEvent[],
    endMs: number,
  ): ShadowAggregationResult {
    const providerIntervals = aggregateAttentionIntervals(providerEvents, endMs);
    const viewabilityIntervals = aggregateAttentionIntervals(viewabilityEvents, endMs);
    const qualifiedIntervals = intersectIntervals(
      providerIntervals.filter(
        (interval) => interval.state === 'ai_processing' || interval.state === 'tool_processing',
      ),
      viewabilityIntervals.filter((interval) => interval.state === 'foreground_visible'),
    );
    const renderedMs = sumDuration(
      viewabilityIntervals.filter(
        (interval) =>
          interval.state === 'foreground_visible' || interval.state === 'foreground_not_visible',
      ),
    );
    const viewableMs = sumDuration(
      viewabilityIntervals.filter((interval) => interval.state === 'foreground_visible'),
    );
    const aiEligibleMs = sumDuration(
      providerIntervals.filter(
        (interval) => interval.state === 'ai_processing' || interval.state === 'tool_processing',
      ),
    );
    const qualifiedMs = sumDuration(
      qualifiedIntervals.filter(
        (interval) => interval.state === 'ai_processing' || interval.state === 'tool_processing',
      ),
    );
    return {
      providerIntervals,
      viewabilityIntervals,
      qualifiedIntervals,
      renderedMs,
      viewableMs,
      aiEligibleMs,
      qualifiedMs,
      financialSideEffects: false,
    };
  }

  aggregateCanonicalEvents(
    events: readonly AgentLifecycleEventV1[],
    viewabilityEvents: readonly ViewabilityIntervalEvent[],
    endMs: number,
  ): ShadowAggregationResult {
    const orderedEvents = [...events].sort(compareCanonicalEvents);
    const providerEvents: AttentionIntervalEvent[] = orderedEvents.map((event) => ({
      atMs: Date.parse(event.occurredAt),
      state: stateForEvent(event),
    }));
    return this.aggregate(
      providerEvents,
      [...viewabilityEvents].sort(compareViewabilityEvents),
      endMs,
    );
  }
}

/**
 * Project only explicit surface/lifecycle observations into viewability
 * observations. Focus or a resumed agent alone is not treated as a visible
 * ad surface; a `surface.visible` event is required to start viewable time.
 */
export function viewabilityEventsForCanonicalEvents(
  events: readonly AgentLifecycleEventV1[],
): ViewabilityIntervalEvent[] {
  return [...events].sort(compareCanonicalEvents).flatMap((event, order) => {
    const atMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(atMs)) return [];
    const state: ViewabilityIntervalEvent['state'] | null = (() => {
      switch (event.eventType) {
        case 'surface.visible':
          return 'foreground_visible';
        case 'surface.hidden':
        case 'user.foregrounded':
        case 'device.unlocked':
        case 'integration.connected':
          return 'foreground_not_visible';
        case 'user.backgrounded':
          return 'background';
        case 'device.locked':
          return 'device_locked';
        case 'integration.disconnected':
          return 'disconnected';
        default:
          return null;
      }
    })();
    return state ? [{ atMs, state, order }] : [];
  });
}

function stateForEvent(event: AgentLifecycleEventV1): AttentionIntervalEvent['state'] {
  // Headless agent work is still useful telemetry, but it is never human
  // attention. The client stamps this context after provider sanitization; an
  // honest CI/cron session therefore cannot create Q even if surface events
  // happen to be present in the same event stream.
  if (event.metadata.executionContext === 'headless') return 'idle';
  switch (event.eventType) {
    case 'turn.submitted':
    case 'user.interacted':
      return 'user_active';
    case 'turn.processing_started':
    case 'input.resolved':
    case 'permission.allowed':
    case 'tool.succeeded':
    case 'tool.failed':
    case 'tool.batch_completed':
    case 'subagent.started':
    case 'subagent.stopped':
    case 'task.created':
    case 'task.completed':
    case 'task.failed':
      return 'ai_processing';
    case 'tool.started':
      return 'tool_processing';
    case 'input.required':
    case 'permission.required':
      return 'user_input_required';
    case 'user.foregrounded':
      return 'unknown';
    default:
      return 'idle';
  }
}

function sumDuration(intervals: readonly AttentionInterval[]): number {
  return intervals.reduce((total, interval) => total + interval.endMs - interval.startMs, 0);
}

function compareCanonicalEvents(left: AgentLifecycleEventV1, right: AgentLifecycleEventV1): number {
  const occurredAt = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  if (occurredAt !== 0) return occurredAt;
  const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  return left.eventId.localeCompare(right.eventId);
}

function compareViewabilityEvents(
  left: ViewabilityIntervalEvent,
  right: ViewabilityIntervalEvent,
): number {
  return (
    left.atMs - right.atMs ||
    (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
    left.state.localeCompare(right.state)
  );
}
