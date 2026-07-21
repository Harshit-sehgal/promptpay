import { describe, expect, it } from 'vitest';

import {
  DETECTOR_VERSION,
  DetectorEvidence,
  signEvidence,
  verifyEvidence,
} from '@waitlayer/shared';

import { classifyWaitState } from './extension.constants';

const WAIT_STATE_ID = 'ws-evidence-1';
const SESSION_ID = 'session-evidence-1';

function makeEvidence(
  overrides: Partial<DetectorEvidence> & { type: DetectorEvidence['type'] },
): DetectorEvidence {
  const item: DetectorEvidence = {
    type: overrides.type,
    sourceType: overrides.sourceType ?? 'observed',
    adapterId: overrides.adapterId ?? 'test.adapter',
    detectorVersion: overrides.detectorVersion ?? DETECTOR_VERSION,
    timestamp: overrides.timestamp ?? Date.now(),
    waitStateId: overrides.waitStateId ?? WAIT_STATE_ID,
    sessionId: overrides.sessionId ?? SESSION_ID,
    correlationId: overrides.correlationId ?? 'corr-1',
    signature: overrides.signature ?? 'fake-sig',
    ...overrides,
  };
  return item;
}

describe('classifyWaitState with evidence (P0)', () => {
  it('requires observed evidence from distinct adapters for payment eligibility', () => {
    const evidence = [
      makeEvidence({ type: 'ai_generation', adapterId: 'vscode.ai-hook' }),
      makeEvidence({ type: 'active_task', adapterId: 'vscode.task' }),
    ];
    const result = classifyWaitState([], true, evidence);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(true);
  });

  it('accepts two distinct observed primary types even from the same adapter', () => {
    const evidence = [
      makeEvidence({ type: 'ai_generation', adapterId: 'vscode.ai-hook' }),
      makeEvidence({ type: 'active_task', adapterId: 'vscode.ai-hook' }),
    ];
    const result = classifyWaitState([], true, evidence);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(true);
  });

  it('rejects payment when corroboration is inferred', () => {
    const evidence = [
      makeEvidence({ type: 'ai_generation', sourceType: 'observed', adapterId: 'vscode.ai-hook' }),
      makeEvidence({
        type: 'command_execution',
        sourceType: 'inferred',
        adapterId: 'cli.heuristic',
      }),
    ];
    const result = classifyWaitState([], true, evidence);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
  });

  it('rejects payment when only one observed primary evidence is supplied', () => {
    const evidence = [makeEvidence({ type: 'ai_generation', sourceType: 'observed' })];
    const result = classifyWaitState([], true, evidence);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
  });

  it('treats signal-only waits as non-billable (no fallback)', () => {
    const result = classifyWaitState(
      [{ type: 'ai_generation' }, { type: 'command_execution' }],
      true,
    );
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
  });

  it('ignores inactivity/lifecycle evidence for payment corroboration', () => {
    const evidence = [
      makeEvidence({ type: 'ai_generation', sourceType: 'observed' }),
      makeEvidence({ type: 'inactivity', sourceType: 'observed' }),
      makeEvidence({ type: 'lifecycle_event', sourceType: 'observed' }),
    ];
    const result = classifyWaitState([], true, evidence);
    expect(result.adEligible).toBe(true);
    expect(result.paymentEligible).toBe(false);
  });
});

describe('evidence signing', () => {
  const secret = 'super-secret-device-key';

  it('verifies a valid evidence signature', () => {
    const item = makeEvidence({ type: 'ai_generation', adapterId: 'cli.runner' });
    delete (item as { signature?: string }).signature;
    const signed = { ...item, signature: signEvidence(item, secret) };
    expect(verifyEvidence(signed, secret)).toBe(true);
  });

  it('rejects a tampered evidence signature', () => {
    const item = makeEvidence({ type: 'ai_generation', adapterId: 'cli.runner' });
    const signed = { ...item, signature: signEvidence(item, secret) };
    signed.sourceType = 'inferred';
    expect(verifyEvidence(signed, secret)).toBe(false);
  });

  it('rejects a cross-wait replay of signed evidence', () => {
    const item = makeEvidence({ type: 'ai_generation', adapterId: 'cli.runner' });
    const signed = { ...item, signature: signEvidence(item, secret) };
    // Reuse the same signed evidence on a different wait state.
    signed.waitStateId = 'ws-other';
    expect(verifyEvidence(signed, secret)).toBe(false);
  });
});
