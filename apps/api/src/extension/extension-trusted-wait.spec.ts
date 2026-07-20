import { describe, expect, it } from 'vitest';

import {
  classifyWaitState,
  computeWaitConfidence,
  isVerifiedDetectorSource,
  MINIMUM_WAIT_CONFIDENCE,
} from './extension.constants';

describe('classifyWaitState (P0.1)', () => {
  it('detects any non-empty signal set', () => {
    const result = classifyWaitState([{ type: 'inactivity' }], false);
    expect(result.detected).toBe(true);
  });

  it('allows a single strong signal to serve an ad (adEligible) but NOT pay', () => {
    const result = classifyWaitState([{ type: 'ai_generation' }], false);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(MINIMUM_WAIT_CONFIDENCE);
    expect(result.reason).toBe('ai_generation');
  });

  it('makes a wait payment-eligible when a primary signal is corroborated', () => {
    const result = classifyWaitState(
      [{ type: 'ai_generation' }, { type: 'command_execution' }],
      false,
    );
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(MINIMUM_WAIT_CONFIDENCE);
  });

  it('rejects payment when the only corroboration is another inactivity signal', () => {
    const result = classifyWaitState([{ type: 'inactivity' }, { type: 'inactivity' }], false);
    expect(result.adEligible).toBe(false);
    expect(result.paymentEligible).toBe(false);
  });

  it('rejects ad eligibility for inactivity-only waits', () => {
    const result = classifyWaitState([{ type: 'inactivity' }], false);
    expect(result.adEligible).toBe(false);
    expect(result.paymentEligible).toBe(false);
    expect(result.confidence).toBeLessThan(MINIMUM_WAIT_CONFIDENCE);
  });

  it('flags unverified detector sources', () => {
    const verified = classifyWaitState([{ type: 'ai_generation' }, { type: 'active_task' }], true);
    const unverified = classifyWaitState(
      [{ type: 'ai_generation' }, { type: 'active_task' }],
      false,
    );
    expect(verified.unverifiedSource).toBe(false);
    expect(unverified.unverifiedSource).toBe(true);
  });

  it('keeps computeWaitConfidence unchanged (max-weight signal)', () => {
    const mixed = computeWaitConfidence([
      { type: 'inactivity' },
      { type: 'ai_generation' },
      { type: 'command_execution' },
    ]);
    expect(mixed.confidence).toBe(0.95);
    expect(mixed.reason).toBe('ai_generation');
  });
});

describe('isVerifiedDetectorSource (P0.1)', () => {
  const originalEnv = process.env.VERIFIED_DETECTOR_VERSIONS;

  afterEach(() => {
    process.env.VERIFIED_DETECTOR_VERSIONS = originalEnv;
  });

  it('treats missing env as unverified (fail-closed)', () => {
    delete process.env.VERIFIED_DETECTOR_VERSIONS;
    expect(isVerifiedDetectorSource('1.0.0')).toBe(false);
  });

  it('verifies a version in the allowlist', () => {
    process.env.VERIFIED_DETECTOR_VERSIONS = '1.0.0, 1.1.0';
    expect(isVerifiedDetectorSource('1.1.0')).toBe(true);
  });

  it('rejects a version not in the allowlist', () => {
    process.env.VERIFIED_DETECTOR_VERSIONS = '1.0.0';
    expect(isVerifiedDetectorSource('2.0.0')).toBe(false);
  });

  it('rejects a missing detector version', () => {
    process.env.VERIFIED_DETECTOR_VERSIONS = '1.0.0';
    expect(isVerifiedDetectorSource(undefined)).toBe(false);
  });
});
