import { describe, expect, it, vi } from 'vitest';

import { AttentionShadowFactService } from './attention-shadow-fact.service';
import { shadowSessionFactDigest } from './attention-shadow-facts';

const factWithoutDigest = {
  datasetVersion: 1 as const,
  sessionKey: 'a'.repeat(64),
  userKey: 'b'.repeat(64),
  deviceKey: 'c'.repeat(64),
  observedAt: '2026-08-31T00:00:00.000Z',
  sessionStartedAt: '2026-08-30T23:59:00.000Z',
  sessionEndedAt: '2026-08-31T00:00:00.000Z',
  environmentKind: 'sandbox' as const,
  environmentId: 'sandbox-1',
  providerClass: 'claude_code',
  integrationMode: 'native_hook',
  toolClass: 'shell',
  policyVersion: 1,
  alphaPpm: 500_000n,
  passiveCapRatioPpm: 1_000_000n,
  passiveSessionCapMs: 60_000,
  minimumQualifiedMs: 1_000,
  renderedMs: 20_000,
  viewableMs: 15_000,
  aiEligibleMs: 10_000,
  qualifiedMs: 10_000,
  passiveMs: 5_000,
  passiveBillableMs: 5_000,
  weightedBillablePpmMs: 12_500_000_000n,
  attestationStatus: 'unverified' as const,
  classificationConfidencePpm: 800_000n,
  fraudRiskStatus: 'unknown' as const,
  unknownEventRatePpm: 0n,
  hypotheticalCurrency: null,
  hypotheticalAdvertiserChargeMinor: null,
  hypotheticalUserRewardMinor: null,
  hypotheticalPlatformContributionMinor: null,
  economicCalculationVersion: null,
  calculationVersion: 'attention-shadow-fact-v1',
  recordedAt: '2026-08-31T00:00:00.000Z',
};
const fact = { ...factWithoutDigest, recordDigest: shadowSessionFactDigest(factWithoutDigest) };

function makePrisma() {
  const tx = {
    attentionSessionPolicyAssignment: {
      findUnique: vi.fn(),
    },
    attentionSessionFact: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx };
}

describe('AttentionShadowFactService', () => {
  it('creates an immutable non-financial fact', async () => {
    const { prisma, tx } = makePrisma();
    tx.attentionSessionPolicyAssignment.findUnique.mockResolvedValue({ policy: { version: 1 } });
    tx.attentionSessionFact.findUnique.mockResolvedValue(null);
    tx.attentionSessionFact.create.mockResolvedValue({});
    const result = await new AttentionShadowFactService(prisma as never).persist('session-1', fact);

    expect(result).toEqual({
      status: 'created',
      sessionId: 'session-1',
      recordDigest: fact.recordDigest,
      financialSideEffects: false,
    });
    expect(tx.attentionSessionFact.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: 'session-1' }) }),
    );
  });

  it('accepts identical replays and rejects conflicting replays', async () => {
    const { prisma, tx } = makePrisma();
    tx.attentionSessionPolicyAssignment.findUnique.mockResolvedValue({ policy: { version: 1 } });
    tx.attentionSessionFact.findUnique.mockResolvedValue({ recordDigest: fact.recordDigest });
    const service = new AttentionShadowFactService(prisma as never);
    await expect(service.persist('session-1', fact)).resolves.toMatchObject({
      status: 'duplicate',
    });
    const conflictingFactWithoutDigest = { ...fact, environmentId: 'sandbox-2' };
    const conflictingFact = {
      ...conflictingFactWithoutDigest,
      recordDigest: shadowSessionFactDigest(conflictingFactWithoutDigest),
    };
    await expect(service.persist('session-1', conflictingFact)).rejects.toThrow(
      'Shadow fact already exists with a different digest',
    );
    expect(tx.attentionSessionFact.create).not.toHaveBeenCalled();
  });

  it('rejects facts whose policy version is not bound to the session', async () => {
    const { prisma, tx } = makePrisma();
    tx.attentionSessionPolicyAssignment.findUnique.mockResolvedValue({ policy: { version: 2 } });
    await expect(
      new AttentionShadowFactService(prisma as never).persist('session-1', fact),
    ).rejects.toThrow('does not match the session assignment');
    expect(tx.attentionSessionFact.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a fact whose content does not match its digest', async () => {
    const { prisma, tx } = makePrisma();
    tx.attentionSessionPolicyAssignment.findUnique.mockResolvedValue({ policy: { version: 1 } });
    await expect(
      new AttentionShadowFactService(prisma as never).persist('session-1', {
        ...fact,
        environmentId: 'sandbox-2',
      }),
    ).rejects.toThrow('recordDigest does not match');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
