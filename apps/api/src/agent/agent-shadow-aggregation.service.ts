import { Injectable } from '@nestjs/common';

import type { AgentLifecycleEventV1 } from '@ateva/agent-protocol';

import {
  aggregateAttentionIntervals,
  AttentionInterval,
  AttentionIntervalEvent,
  intersectIntervals,
} from './attention-interval-aggregator';

export type ViewabilityIntervalEvent = Omit<AttentionIntervalEvent, 'state'> & {
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
    const providerEvents: AttentionIntervalEvent[] = events.map((event) => ({
      atMs: Date.parse(event.occurredAt),
      state: stateForEvent(event),
    }));
    return this.aggregate(providerEvents, viewabilityEvents, endMs);
  }
}

function stateForEvent(event: AgentLifecycleEventV1): AttentionIntervalEvent['state'] {
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
