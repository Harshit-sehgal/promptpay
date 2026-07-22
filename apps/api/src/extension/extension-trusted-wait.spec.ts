import { describe, expect, it } from 'vitest';

import { makeTestEvidence } from './evidence.test-helper';
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

  it('makes a wait payment-eligible only when verified and corroborated by observed evidence from distinct adapters', () => {
    const evidence = makeTestEvidence([
      { type: 'active_task', adapterId: 'vscode.task' },
      { type: 'command_execution', adapterId: 'vscode.terminal' },
    ]);
    const result = classifyWaitState([], true, evidence);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(MINIMUM_WAIT_CONFIDENCE);
  });

  it('keeps corroborated evidence non-billable when the detector version is not verified', () => {
    const evidence = makeTestEvidence([
      { type: 'active_task', adapterId: 'vscode.task' },
      { type: 'command_execution', adapterId: 'vscode.terminal' },
    ]);
    const result = classifyWaitState([], false, evidence);

    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
    expect(result.unverifiedSource).toBe(true);
  });

  it('rejects payment when a primary signal is only corroborated by a lifecycle event', () => {
    const result = classifyWaitState(
      [{ type: 'ai_generation' }, { type: 'lifecycle_event' }],
      false,
    );
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
  });

  it('rejects payment when duplicate primary signals are repeated (must be distinct types)', () => {
    const result = classifyWaitState([{ type: 'ai_generation' }, { type: 'ai_generation' }], false);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
  });

  it('rejects payment when the only second signal is inactivity', () => {
    const result = classifyWaitState([{ type: 'ai_generation' }, { type: 'inactivity' }], false);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
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
    const evidence = makeTestEvidence([
      { type: 'ai_generation', adapterId: 'vscode.ai-hook' },
      { type: 'active_task', adapterId: 'vscode.task' },
    ]);
    const verified = classifyWaitState([], true, evidence);
    const unverified = classifyWaitState([], false, evidence);
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
  it('treats missing env as unverified (fail-closed)', () => {
    expect(isVerifiedDetectorSource('1.0.0', '')).toBe(false);
  });

  it('verifies a version in the allowlist', () => {
    expect(isVerifiedDetectorSource('1.1.0', '1.0.0, 1.1.0')).toBe(true);
  });

  it('rejects a version not in the allowlist', () => {
    expect(isVerifiedDetectorSource('2.0.0', '1.0.0')).toBe(false);
  });

  it('rejects a missing detector version', () => {
    expect(isVerifiedDetectorSource(undefined, '1.0.0')).toBe(false);
  });
});
