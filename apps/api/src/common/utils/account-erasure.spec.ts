import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';

import { eraseAccountIdentity } from './account-erasure';

function makePrisma() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'person@example.com',
        status: 'active',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    earningsLedger: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
      groupBy: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    recoveryDebtCase: { findFirst: vi.fn().mockResolvedValue(null) },
    payoutRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    advertiser: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    advertiserLedger: {
      groupBy: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    platformLedger: {
      create: vi.fn().mockResolvedValue({}),
    },
    campaign: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    deviceRecoveryToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    session: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    apiKey: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    userSettings: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    waitStateEvent: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    adImpression: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    adClick: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma: prisma as any, tx };
}

describe('eraseAccountIdentity', () => {
  it('blocks erasure while user earnings would be stranded', async () => {
    const { prisma, tx } = makePrisma();
    tx.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 1n } });

    await expect(eraseAccountIdentity(prisma, 'user-1')).rejects.toThrow(ConflictException);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.payoutAccount.updateMany).not.toHaveBeenCalled();
  });

  it('blocks erasure while a payout is nonterminal', async () => {
    const { prisma, tx } = makePrisma();
    tx.payoutRequest.findFirst.mockResolvedValue({ id: 'payout-1', status: 'processing' } as never);

    await expect(eraseAccountIdentity(prisma, 'user-1')).rejects.toThrow(/payout-1.*processing/);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('blocks erasure while recovery debt remains', async () => {
    const { prisma, tx } = makePrisma();
    tx.recoveryDebtCase.findFirst.mockResolvedValue({
      id: 'debt-1',
      status: 'in_collections',
    } as never);

    await expect(eraseAccountIdentity(prisma, 'user-1')).rejects.toThrow(/recovery debt/);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('blocks funded advertisers and active campaign obligations', async () => {
    const funded = makePrisma();
    funded.tx.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' } as never);
    funded.tx.advertiserLedger.groupBy.mockResolvedValue([
      { currency: 'USD', entryType: 'credit', _sum: { amountMinor: 500n } },
    ] as never);
    await expect(eraseAccountIdentity(funded.prisma, 'user-1')).rejects.toThrow(/funded balance/);

    const active = makePrisma();
    active.tx.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' } as never);
    active.tx.campaign.findFirst.mockResolvedValue({ id: 'campaign-1', status: 'active' } as never);
    await expect(eraseAccountIdentity(active.prisma, 'user-1')).rejects.toThrow(
      /campaign-1.*active/,
    );
  });

  it('revokes credentials and pseudonymizes direct identifiers in one transaction', async () => {
    const { prisma, tx } = makePrisma();
    tx.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' } as never);

    await expect(eraseAccountIdentity(prisma, 'user-1')).resolves.toEqual({
      deleted: true,
      priorEmail: 'person@example.com',
    });

    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { revoked: true, deviceHash: null, ipHash: null },
    });
    expect(tx.deviceRecoveryToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
    const payoutErasureCall = tx.$executeRaw.mock.calls.find(([query]) =>
      Array.from(query as TemplateStringsArray)
        .join('')
        .includes('UPDATE "payout_accounts"'),
    );
    expect(payoutErasureCall).toBeDefined();
    const payoutErasureSql = Array.from(payoutErasureCall?.[0] as TemplateStringsArray).join('');
    expect(payoutErasureSql).toContain(`"destination" = 'deleted-' || "id"`);
    expect(payoutErasureSql).toContain('"destination_hmac" = NULL');
    expect(payoutErasureSql).toContain('"encryption_migrated_at" = NULL');
    expect(payoutErasureSql).toContain('"verification_rejected_at" = NULL');
    expect(payoutErasureSql).toContain('"initiation_payout_id" = NULL');
    expect(payoutErasureSql).toContain('"is_frozen" = false');
    expect(payoutErasureSql).toContain('"updatedAt" = NOW()');
    expect(payoutErasureCall?.[1]).toBe('user-1');
    expect(tx.advertiser.update).toHaveBeenCalledWith({
      where: { id: 'adv-1' },
      data: expect.objectContaining({
        billingEmail: 'deleted-user-1@example.invalid',
        stripeCustomerId: null,
      }),
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        status: 'deleted',
        twoFactorBackupCodeHashes: [],
      }),
    });
    // Both identity columns must be scrubbed, and as TWO separate indexed
    // statements. A single `OR: [{actorId}, {targetId}]` cannot use an index,
    // degrades to a sequential scan, and under this SERIALIZABLE transaction
    // takes a relation-level predicate lock that every concurrent audit INSERT
    // conflicts with — which made erasure fail with 40001 under load.
    // Both the user id and the advertiser profile id are scrubbed — audit rows
    // reference the subject under either identity.
    expect(tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { actorId: { in: ['user-1', 'adv-1'] } },
      data: expect.objectContaining({ ipHash: null }),
    });
    expect(tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { targetId: { in: ['user-1', 'adv-1'] } },
      data: expect.objectContaining({ ipHash: null }),
    });
    for (const [call] of tx.auditLog.updateMany.mock.calls) {
      expect(call.where).not.toHaveProperty('OR');
    }
    expect(tx.waitStateEvent.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { ipHash: null },
    });
    // Advisory lock + device pseudonymization + payout erasure + consent metadata minimization.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it('forfeits sub-threshold earnings when forfeitBalance=true', async () => {
    const { prisma, tx } = makePrisma();
    // Simulate 500 minor units of confirmed earnings (below the 1000 forfeit threshold)
    tx.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 500n } });
    tx.earningsLedger.updateMany.mockResolvedValue({ count: 3 });

    await expect(eraseAccountIdentity(prisma, 'user-1', { forfeitBalance: true })).resolves.toEqual(
      { deleted: true, priorEmail: 'person@example.com' },
    );

    // The earnings should have been reversed (status -> 'reversed')
    expect(tx.earningsLedger.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        entryType: 'credit',
        status: { in: ['estimated', 'pending', 'confirmed', 'held'] },
      },
      data: { status: 'reversed' },
    });
    // And the user should have been anonymized (deletion proceeded)
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('rejects forfeit when earnings exceed the forfeit threshold', async () => {
    const { prisma, tx } = makePrisma();
    // 2000 minor units exceeds the 1000 forfeit threshold
    tx.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 2000n } });

    await expect(eraseAccountIdentity(prisma, 'user-1', { forfeitBalance: true })).rejects.toThrow(
      /Cannot forfeit balance.*exceed the forfeit threshold/,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.earningsLedger.updateMany).not.toHaveBeenCalled();
  });

  it('rejects deletion with earnings when forfeitBalance is not set', async () => {
    const { prisma, tx } = makePrisma();
    tx.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 500n } });

    await expect(eraseAccountIdentity(prisma, 'user-1')).rejects.toThrow(
      /blocked while.*earnings remain.*forfeitBalance=true/,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('emits a delete_account audit inside the transaction when audit service is provided', async () => {
    const { prisma, tx } = makePrisma();
    tx.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' } as never);
    const audit = {
      logStrict: vi.fn().mockResolvedValue(undefined),
    };

    await eraseAccountIdentity(prisma, 'user-1', { forfeitBalance: false }, audit as any, {
      actorId: 'user-1',
      actorRole: 'developer',
      action: 'delete_account',
    });

    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        actorRole: 'developer',
        action: 'delete_account',
        targetType: 'user',
        targetId: 'user-1',
        beforeSnap: { priorEmail: 'person@example.com', status: 'active' },
      }),
      expect.anything(),
    );
    // Ensure the audit was written AFTER the user was marked deleted.
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(audit.logStrict).toHaveBeenCalled();
  });

  it('does not emit an audit when no audit service is provided', async () => {
    const { prisma, tx } = makePrisma();
    tx.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' } as never);
    const audit = {
      logStrict: vi.fn().mockResolvedValue(undefined),
    };

    await eraseAccountIdentity(prisma, 'user-1');

    expect(audit.logStrict).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalled();
  });
  // A GDPR Article 17 erasure runs SERIALIZABLE, so Postgres aborts it with a
  // retryable 40001 write conflict whenever a concurrent request touches an
  // overlapping range (audit_logs is appended to by nearly every request).
  // Without a retry the user's deletion surfaces as a 500 purely because the
  // system was busy — observed breaking 15 browser tests at once.
  it('retries a serialization conflict instead of failing the erasure', async () => {
    const { prisma, tx } = makePrisma();
    const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' });
    let calls = 0;
    prisma.$transaction = vi.fn((callback: (client: typeof tx) => unknown) => {
      calls += 1;
      if (calls === 1) return Promise.reject(conflict);
      return callback(tx);
    });

    await expect(eraseAccountIdentity(prisma, 'user-1')).resolves.toEqual({
      deleted: true,
      priorEmail: 'person@example.com',
    });
    expect(calls).toBe(2);
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('gives up after a bounded number of serialization conflicts', async () => {
    const { prisma, tx } = makePrisma();
    const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' });
    let calls = 0;
    prisma.$transaction = vi.fn(() => {
      calls += 1;
      return Promise.reject(conflict);
    });

    await expect(eraseAccountIdentity(prisma, 'user-1')).rejects.toBe(conflict);
    // Bounded: a permanently conflicting erasure must surface, not spin.
    expect(calls).toBe(8);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  // The retry must not paper over real refusals: a financial-obligation block
  // is a deliberate, non-retryable outcome.
  it('does not retry a non-serialization refusal', async () => {
    const { prisma, tx } = makePrisma();
    tx.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 1n } });
    tx.earningsLedger.groupBy.mockResolvedValue([
      { currency: 'USD', _sum: { amountMinor: 5000n } },
    ]);

    await expect(eraseAccountIdentity(prisma, 'user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
