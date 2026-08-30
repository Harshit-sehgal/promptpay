import { describe, expect, it } from 'vitest';

import { aggregateAttentionIntervals, intersectIntervals } from './attention-interval-aggregator';

describe('attention interval aggregator', () => {
  it('builds ordered intervals and merges adjacent equal states', () => {
    expect(
      aggregateAttentionIntervals(
        [
          { atMs: 0, state: 'idle' },
          { atMs: 1_000, state: 'ai_processing' },
          { atMs: 2_000, state: 'ai_processing' },
          { atMs: 3_000, state: 'user_input_required' },
        ],
        5_000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 1_000, state: 'idle' },
      { startMs: 1_000, endMs: 3_000, state: 'ai_processing' },
      { startMs: 3_000, endMs: 5_000, state: 'user_input_required' },
    ]);
  });

  it('clips events after the aggregation end and ignores zero-width intervals', () => {
    expect(
      aggregateAttentionIntervals(
        [
          { atMs: 100, state: 'ai_processing' },
          { atMs: 1_000, state: 'idle' },
          { atMs: 2_000, state: 'unknown' },
        ],
        1_500,
      ),
    ).toEqual([
      { startMs: 100, endMs: 1_000, state: 'ai_processing' },
      { startMs: 1_000, endMs: 1_500, state: 'idle' },
    ]);
  });

  it('intersects provider eligibility with viewability without inventing state', () => {
    expect(
      intersectIntervals(
        [{ startMs: 0, endMs: 10_000, state: 'ai_processing' }],
        [{ startMs: 2_000, endMs: 6_000, state: 'foreground_visible' as never }],
      ),
    ).toEqual([{ startMs: 2_000, endMs: 6_000, state: 'ai_processing' }]);
  });

  it('rejects non-integer timestamps and invalid aggregation bounds', () => {
    expect(() => aggregateAttentionIntervals([{ atMs: 1.5, state: 'idle' }], 2_000)).toThrow();
    expect(() => aggregateAttentionIntervals([], -1)).toThrow();
  });
});
