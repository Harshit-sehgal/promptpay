export type AttentionIntervalState =
  | 'user_active'
  | 'ai_processing'
  | 'tool_processing'
  | 'user_input_required'
  | 'idle'
  | 'not_viewable'
  | 'unknown'
  | 'foreground_visible'
  | 'foreground_not_visible'
  | 'background'
  | 'device_locked'
  | 'disconnected';

export type AttentionIntervalEvent = {
  atMs: number;
  state: AttentionIntervalState;
};

export type AttentionInterval = {
  startMs: number;
  endMs: number;
  state: AttentionIntervalState;
};

/**
 * Reconstruct non-financial state intervals from ordered observations.
 * Equal timestamps are resolved by input order; callers should provide their
 * canonical event order. No interval produced here authorizes money.
 */
export function aggregateAttentionIntervals(
  events: readonly AttentionIntervalEvent[],
  endMs: number,
): AttentionInterval[] {
  if (!Number.isInteger(endMs) || endMs < 0)
    throw new Error('endMs must be a non-negative integer');
  const ordered = events.map(validateEvent).sort((left, right) => left.atMs - right.atMs);
  const intervals: AttentionInterval[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const nextAt = ordered[index + 1]?.atMs ?? endMs;
    const intervalEnd = Math.min(nextAt, endMs);
    if (current.atMs >= endMs || intervalEnd <= current.atMs) continue;
    intervals.push({ startMs: current.atMs, endMs: intervalEnd, state: current.state });
  }
  return mergeAdjacentIntervals(intervals);
}

export function intersectIntervals(
  left: readonly AttentionInterval[],
  right: readonly AttentionInterval[],
): AttentionInterval[] {
  const result: AttentionInterval[] = [];
  for (const a of left) {
    for (const b of right) {
      const startMs = Math.max(a.startMs, b.startMs);
      const endMs = Math.min(a.endMs, b.endMs);
      if (endMs > startMs) result.push({ startMs, endMs, state: a.state });
    }
  }
  return mergeAdjacentIntervals(result.sort((a, b) => a.startMs - b.startMs));
}

function validateEvent(event: AttentionIntervalEvent): AttentionIntervalEvent {
  if (!Number.isInteger(event.atMs) || event.atMs < 0) {
    throw new Error('event timestamp must be a non-negative integer');
  }
  return event;
}

function mergeAdjacentIntervals(intervals: AttentionInterval[]): AttentionInterval[] {
  const merged: AttentionInterval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && previous.endMs === interval.startMs && previous.state === interval.state) {
      previous.endMs = interval.endMs;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}
