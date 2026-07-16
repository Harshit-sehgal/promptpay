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
    expect(tx.payoutAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: {
        destination: 'deleted-user-1',
        isActive: false,
        isVerified: false,
      },
    });
    expect(tx.advertiser.update).toHaveBeenCalledWith({
      where: { id: 'adv-1' },
      data: expect.objectContaining({
        billingEmail: 'deleted-user-1@waitlayer.com',
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
    expect(tx.auditLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipHash: null }),
      }),
    );
    expect(tx.waitStateEvent.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { ipHash: null },
    });
    // Advisory lock + device pseudonymization + consent metadata minimization.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });
});
