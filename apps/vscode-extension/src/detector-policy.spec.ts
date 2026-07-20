import { describe, expect, it } from 'vitest';

import {
  assignVariant,
  computeExperiment,
  computeSuppressUntil,
  hashToBucket,
  isEnrolled,
  isSourceDisabled,
  isSuppressed,
  KNOWN_DETECTOR_SOURCES,
} from './detector-policy';

describe('detector-policy hashing & bucketing (P1.17)', () => {
  it('maps an id to a stable 0–99 bucket', () => {
    const b1 = hashToBucket('user-123');
    const b2 = hashToBucket('user-123');
    expect(b1).toBe(b2);
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(100);
  });

  it('spreads distinct ids across many buckets', () => {
    const buckets = new Set(Array.from({ length: 200 }, (_, i) => hashToBucket(`user-${i}`)));
    // 200 distinct ids must not collapse onto a handful of buckets.
    expect(buckets.size).toBeGreaterThan(50);
  });

  it('empty id maps to bucket 0', () => {
    expect(hashToBucket('')).toBe(0);
  });
});

describe('detector rollout enrollment (P1.17)', () => {
  it('enrolls everyone at 100% rollout', () => {
    for (let b = 0; b < 100; b++) expect(isEnrolled(b, 100)).toBe(true);
  });

  it('enrolls no one at 0% rollout', () => {
    for (let b = 0; b < 100; b++) expect(isEnrolled(b, 0)).toBe(false);
  });

  it('enrolls exactly the first N buckets at an N% rollout', () => {
    expect(isEnrolled(0, 10)).toBe(true);
    expect(isEnrolled(9, 10)).toBe(true);
    expect(isEnrolled(10, 10)).toBe(false);
    expect(isEnrolled(99, 10)).toBe(false);
  });

  it('assigns a stable variant per bucket (even=control, odd=treatment)', () => {
    expect(assignVariant(0)).toBe('control');
    expect(assignVariant(2)).toBe('control');
    expect(assignVariant(3)).toBe('treatment');
    expect(assignVariant(99)).toBe('treatment');
  });

  it('computeExperiment uses userId ?? machineId and respects rollout', () => {
    const enrolled = computeExperiment('user-a', 'machine-X', 100);
    expect(enrolled.enrolled).toBe(true);
    expect(enrolled.variant).not.toBeNull();

    const anon = computeExperiment(null, 'machine-X', 100);
    expect(anon.enrolled).toBe(true);

    const none = computeExperiment(null, 'machine-X', 0);
    expect(none.enrolled).toBe(false);
    expect(none.variant).toBeNull();
  });

  it('exposes the known detector sources', () => {
    expect(KNOWN_DETECTOR_SOURCES).toContain('inactivity');
    expect(KNOWN_DETECTOR_SOURCES).toContain('terminal');
    expect(KNOWN_DETECTOR_SOURCES).toContain('task');
    expect(KNOWN_DETECTOR_SOURCES).toContain('editor_idle');
  });
});

describe('per-source kill switch (P1.17 / P1.18)', () => {
  it('detects disabled sources case-insensitively', () => {
    expect(isSourceDisabled('Inactivity', ['inactivity'])).toBe(true);
    expect(isSourceDisabled('task', ['terminal', 'TASK'])).toBe(true);
    expect(isSourceDisabled('task', ['inactivity'])).toBe(false);
  });
});

describe('false-positive suppression window (P1.18)', () => {
  it('is active only while now < suppressUntil', () => {
    expect(isSuppressed(1000, 500)).toBe(true);
    expect(isSuppressed(1000, 1000)).toBe(false);
    expect(isSuppressed(1000, 1500)).toBe(false);
    expect(isSuppressed(undefined, 500)).toBe(false);
  });

  it('computeSuppressUntil adds minutes as milliseconds', () => {
    expect(computeSuppressUntil(30, 0)).toBe(30 * 60_000);
    expect(computeSuppressUntil(0, 100)).toBe(100);
  });
});
