import { describe, expect, it } from 'vitest';

import {
  adCacheKey,
  adIdempotencyCacheKey,
  isCategoryBlocked,
  mergeBlockedCategories,
} from './extension.service';

describe('mergeBlockedCategories (A-057 / #3)', () => {
  it('returns persisted when no requested', () => {
    expect(mergeBlockedCategories(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('returns empty when both absent', () => {
    expect(mergeBlockedCategories(undefined)).toEqual([]);
    expect(mergeBlockedCategories(undefined, null)).toEqual([]);
  });
  it('unions persisted + requested without duplicates', () => {
    expect(mergeBlockedCategories(['a'], ['b', 'a'])).toEqual(['a', 'b']);
  });
  it('ignores empty requested and keeps persisted', () => {
    expect(mergeBlockedCategories(['a'], [])).toEqual(['a']);
  });
});

describe('isCategoryBlocked (A-057 / #3)', () => {
  it('false when nothing blocked', () => {
    expect(isCategoryBlocked([], 'news')).toBe(false);
  });
  it('true only when the category is in the blocked set', () => {
    expect(isCategoryBlocked(['news'], 'news')).toBe(true);
    expect(isCategoryBlocked(['news'], 'sports')).toBe(false);
  });
});

describe('ad cache keys (A-038 / #3)', () => {
  it('builds deterministic cache keys', () => {
    expect(adCacheKey('u', 'd', 'w')).toBe('u:d:w');
    expect(adIdempotencyCacheKey('u', 'd', 'k')).toBe('u:d:k');
  });
});
