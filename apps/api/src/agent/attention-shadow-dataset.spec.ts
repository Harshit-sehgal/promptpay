import { describe, expect, it } from 'vitest';

import { buildShadowDatasetRow } from './attention-shadow-dataset';

describe('shadow attention dataset builder', () => {
  const policy = {
    version: 1,
    status: 'shadow' as const,
    alphaPpm: 500_000n,
    passiveCapRatioPpm: 1_000_000n,
    passiveSessionCapMs: 60_000,
    minimumQualifiedMs: 1_000,
  };

  it('composes telemetry into a pseudonymized row and candidate comparisons', () => {
    const result = buildShadowDatasetRow(
      {
        sessionId: 'session-secret-id',
        pseudonymKey: 'dataset-key',
        environmentKind: 'sandbox',
        providerClass: 'Claude Code',
        integrationMode: 'native hook',
        experimentVariant: 'alpha-050',
        providerEvents: [
          { atMs: 0, state: 'ai_processing' },
          { atMs: 10_000, state: 'user_input_required' },
        ],
        viewabilityEvents: [
          { atMs: 0, state: 'foreground_visible' },
          { atMs: 5_000, state: 'background' },
        ],
        endMs: 10_000,
      },
      policy,
      [{ ...policy, version: 2, alphaPpm: 250_000n }],
    );

    expect(result.record.sessionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result.record.providerClass).toBe('claude_code');
    expect(result.record.integrationMode).toBe('native_hook');
    expect(result.record.qualifiedMs).toBe(5_000);
    expect(result.record.passiveMs).toBe(0);
    expect(result.record.passiveBillableMs).toBe(0);
    expect(result.policyComparisons.candidates).toHaveLength(2);
    expect(result.financialSideEffects).toBe(false);
    expect(JSON.stringify(result)).not.toContain('advertiserCharge');
    expect(JSON.stringify(result)).not.toContain('userReward');
  });

  it('rejects unbounded dimensions and missing pseudonym keys', () => {
    expect(() =>
      buildShadowDatasetRow(
        {
          sessionId: 'session',
          pseudonymKey: '',
          environmentKind: 'sandbox',
          providerClass: 'claude_code',
          integrationMode: 'native_hook',
          providerEvents: [],
          viewabilityEvents: [],
          endMs: 0,
        },
        policy,
      ),
    ).toThrow();
    expect(() =>
      buildShadowDatasetRow(
        {
          sessionId: 'session',
          pseudonymKey: 'key',
          environmentKind: 'sandbox',
          providerClass: 'provider with spaces',
          integrationMode: 'native_hook',
          providerEvents: [],
          viewabilityEvents: [],
          endMs: 0,
        },
        policy,
      ),
    ).not.toThrow();
  });
});
