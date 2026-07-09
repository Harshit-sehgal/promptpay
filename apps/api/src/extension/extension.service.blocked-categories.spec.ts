import { describe, expect, it } from 'vitest';

import { isCategoryBlocked, mergeBlockedCategories } from './extension.service';

describe('blocked-category merge + suppression (A-057)', () => {
  it('falls back to the persisted set when no per-request categories are supplied', () => {
    expect(mergeBlockedCategories(['finance', 'dating'], undefined)).toEqual(['finance', 'dating']);
  });

  it('uses an empty set when nothing is configured', () => {
    expect(mergeBlockedCategories(undefined, undefined)).toEqual([]);
    expect(mergeBlockedCategories([], [])).toEqual([]);
    expect(mergeBlockedCategories(undefined, null)).toEqual([]);
  });

  it('unions persisted and per-request categories and de-duplicates', () => {
    expect(mergeBlockedCategories(['finance'], ['dating', 'finance'])).toEqual([
      'finance',
      'dating',
    ]);
  });

  it('persisted preferences still suppress a matching campaign even when the client omits the array', () => {
    const blocked = mergeBlockedCategories(['finance'], undefined);
    expect(isCategoryBlocked(blocked, 'finance')).toBe(true);
    expect(isCategoryBlocked(blocked, 'gaming')).toBe(false);
  });

  it('per-request categories suppress a matching campaign even without a persisted set', () => {
    const blocked = mergeBlockedCategories(undefined, ['dating']);
    expect(isCategoryBlocked(blocked, 'dating')).toBe(true);
    expect(isCategoryBlocked(blocked, 'finance')).toBe(false);
  });

  it('does not suppress an unrelated category when only the blocked one is configured', () => {
    const blocked = mergeBlockedCategories(['finance'], undefined);
    expect(isCategoryBlocked(blocked, 'finance')).toBe(true);
    // Counter-example: a differently spelled slug must not be suppressed.
    expect(isCategoryBlocked(blocked, 'financial-services')).toBe(false);
    expect(isCategoryBlocked(blocked, 'FINANCE')).toBe(false);
  });

  it('blocks a campaign when either persisted or per-request sets contain its category', () => {
    const blocked = mergeBlockedCategories(['finance'], ['dating']);
    expect(isCategoryBlocked(blocked, 'finance')).toBe(true);
    expect(isCategoryBlocked(blocked, 'dating')).toBe(true);
    expect(isCategoryBlocked(blocked, 'gaming')).toBe(false);
  });
});
