import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { PayoutService } from './payout.service';

function makePayoutService(prismaOverrides: Record<string, unknown> = {}, require2fa = false) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'u1',
        status: 'active',
        emailVerified: true,
        twoFactorEnabled: false,
      }),
    },
    earningsLedger: {
      // available = confirmed credits − confirmed debits − allocated. Mock the
      // real credit/debit semantics so the verification guard (not the
      // insufficient-earnings guard) is the one under test.
      aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
        if (args?.where?.entryType === 'debit') {
          return Promise.resolve({ _sum: { amountMinor: 0n } });
        }
        return Promise.resolve({ _sum: { amountMinor: 10_00n } });
      }),
    },
    payoutAllocation: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
    },
    fraudFlag: { count: vi.fn().mockResolvedValue(0) },
    payoutAccount: { findUnique: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    ...prismaOverrides,
  };
  const config = {
    get: vi.fn((key: string) =>
      key === 'PAYOUT_REQUIRE_2FA' ? (require2fa ? 'true' : undefined) : undefined,
    ),
  } as unknown as ConstructorParameters<typeof PayoutService>[4];
  const service = new PayoutService(
    prisma as never,
    {} as LedgerService,
    {} as ReferralService,
    { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    config,
    {} as never,
    {} as never,
    {} as never,
  );
  return { prisma, service };
}

describe('PayoutService.requestPayout payout-account verification', () => {
  it('rejects a payout to an unverified destination', async () => {
    const { prisma, service } = makePayoutService();
    prisma.payoutAccount.findUnique.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      isVerified: false,
      currency: 'USD',
      createdAt: new Date(),
    });

    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a payout to a verified destination', async () => {
    const { prisma, service } = makePayoutService();
    prisma.payoutAccount.findUnique.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      isVerified: true,
      currency: 'USD',
      createdAt: new Date(),
    });
    prisma.payoutRequest = { create: vi.fn().mockResolvedValue({ id: 'pr1' }) };

    // We only assert it gets past the verification gate (no ForbiddenException).
    // Allocation will fail on the mocked ledger, but that is a different error.
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.not.toThrow(ForbiddenException);
  });

  it('blocks a payout when PAYOUT_REQUIRE_2FA is true and 2FA is not enrolled', async () => {
    const { prisma, service } = makePayoutService({}, true);
    prisma.payoutAccount.findUnique.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      isVerified: true,
      currency: 'USD',
      createdAt: new Date(),
    });

    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('PayoutService.requestPayout 2FA enforcement (A-035)', () => {
  const verifiedAccount = {
    id: 'acc1',
    userId: 'u1',
    isVerified: true,
    currency: 'USD',
    createdAt: new Date(),
  };

  function twoFactorUser(enabled: boolean) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1',
          status: 'active',
          emailVerified: true,
          twoFactorEnabled: enabled,
        }),
      },
      payoutAccount: { findUnique: vi.fn().mockResolvedValue(verifiedAccount) },
    };
  }

  it('allows a payout when PAYOUT_REQUIRE_2FA is true and 2FA is enrolled', async () => {
    const { prisma, service } = makePayoutService(twoFactorUser(true), true);

    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.not.toThrow(ForbiddenException);

    // Reaching the account lookup proves the 2FA gate did not block.
    expect(prisma.payoutAccount.findUnique).toHaveBeenCalled();
  });

  it('allows a payout when PAYOUT_REQUIRE_2FA is false even with 2FA enrolled', async () => {
    const { prisma, service } = makePayoutService(twoFactorUser(true), false);

    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.not.toThrow(ForbiddenException);

    expect(prisma.payoutAccount.findUnique).toHaveBeenCalled();
  });
});

describe('PayoutService.getPayoutInfo payout policy metadata', () => {
  it('returns the payout 2FA policy and the user enrollment state', async () => {
    const { service } = makePayoutService(
      {
        user: {
          findUnique: vi.fn().mockResolvedValue({ twoFactorEnabled: false }),
        },
        payoutAccount: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn(),
        },
        payoutRequest: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        earningsLedger: {
          groupBy: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn(),
        },
        payoutAllocation: {
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        },
      },
      true,
    );

    const info = await service.getPayoutInfo('u1');

    expect(info.requiresTwoFactorForPayout).toBe(true);
    expect(info.twoFactorEnabled).toBe(false);
  });

  it('subtracts reserved allocations with a grouped SQL sum instead of loading rows', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ currency: 'USD', amountMinor: 150n }]);
    const { service } = makePayoutService({
      $queryRaw: queryRaw,
      user: {
        findUnique: vi.fn().mockResolvedValue({ twoFactorEnabled: true }),
      },
      payoutAccount: {
        findMany: vi.fn().mockResolvedValue([{ id: 'acc1', currency: 'USD' }]),
        findUnique: vi.fn(),
      },
      payoutRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      earningsLedger: {
        groupBy: vi.fn((args: { where?: { entryType?: string } }) => {
          if (args.where?.entryType === 'debit') {
            return Promise.resolve([{ currency: 'USD', _sum: { amountMinor: 100n } }]);
          }
          return Promise.resolve([{ currency: 'USD', _sum: { amountMinor: 1000n } }]);
        }),
        aggregate: vi.fn(),
      },
    });

    const info = await service.getPayoutInfo('u1');

    expect(queryRaw).toHaveBeenCalled();
    expect(info.availableBalanceMinor).toBe(750n);
    expect(info.availableBalanceByCurrency).toEqual({ USD: 750n });
  });
});

describe('PayoutService.getAvailableForPayout bounded availability (A-071)', () => {
  it('uses aggregate totals and returns a paginated entry slice', async () => {
    const eligibleWhere = expect.objectContaining({
      userId: 'u1',
      status: 'confirmed',
      entryType: 'credit',
      payoutAllocations: {
        none: {
          payoutRequest: {
            userId: 'u1',
            status: expect.any(Object),
          },
        },
      },
    });
    const earningsLedger = {
      groupBy: vi.fn((args: { where?: { entryType?: string } }) => {
        if (args.where?.entryType === 'debit') {
          return Promise.resolve([{ currency: 'USD', _sum: { amountMinor: 100n } }]);
        }
        return Promise.resolve([{ currency: 'USD', _sum: { amountMinor: 1000n } }]);
      }),
      findMany: vi.fn().mockResolvedValue([
        { id: 'e3', amountMinor: 300n, currency: 'USD' },
        { id: 'e4', amountMinor: 400n, currency: 'USD' },
        { id: 'e5', amountMinor: 500n, currency: 'USD' },
      ]),
      count: vi.fn().mockResolvedValue(5),
      aggregate: vi.fn(),
    };
    const { service } = makePayoutService({ earningsLedger });

    const available = await service.getAvailableForPayout('u1', { page: 2, limit: 2 });

    expect(earningsLedger.groupBy).toHaveBeenCalledWith({
      by: ['currency'],
      where: eligibleWhere,
      _sum: { amountMinor: true },
    });
    expect(earningsLedger.findMany).toHaveBeenCalledWith({
      where: eligibleWhere,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: 2,
      take: 3,
    });
    expect(available.entries).toHaveLength(2);
    expect(available.count).toBe(5);
    expect(available.page).toBe(2);
    expect(available.limit).toBe(2);
    expect(available.hasMore).toBe(true);
    expect(available.totalMinor).toBe(900n);
    expect(available.totalsByCurrency).toEqual({ USD: 900n });
  });
});

describe('PayoutService.allocatePayoutEarnings bounded auto-selection (A-071)', () => {
  it('reads auto-allocation candidates in bounded pages until the request is covered', async () => {
    const { service } = makePayoutService();
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: `earn_${index}`,
      userId: 'u1',
      campaignId: null,
      impressionId: null,
      clickId: null,
      entryType: 'credit',
      status: 'confirmed',
      amountMinor: 1n,
      currency: 'USD',
      availableAt: null,
      description: null,
      createdAt: new Date(index),
    }));
    const secondPageEntry = {
      id: 'earn_500',
      userId: 'u1',
      campaignId: null,
      impressionId: null,
      clickId: null,
      entryType: 'credit',
      status: 'confirmed',
      amountMinor: 200n,
      currency: 'USD',
      availableAt: null,
      description: null,
      createdAt: new Date(500),
    };
    const tx = {
      earningsLedger: {
        findMany: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([secondPageEntry]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'remainder' }),
      },
      payoutAllocation: {
        create: vi.fn().mockResolvedValue({ id: 'alloc' }),
      },
    };

    await (
      service as unknown as {
        allocatePayoutEarnings: (
          tx: typeof tx,
          payoutRequestId: string,
          userId: string,
          amountMinor: number,
          currency: string,
        ) => Promise<unknown>;
      }
    ).allocatePayoutEarnings(tx, 'pr1', 'u1', 600n, 'USD');

    expect(tx.earningsLedger.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 500 }),
    );
    expect(tx.earningsLedger.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: 'earn_499' }, skip: 1, take: 500 }),
    );
    expect(tx.payoutAllocation.create).toHaveBeenCalledTimes(501);
    expect(tx.earningsLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountMinor: 100n,
          idempotencyKey: 'payout-remainder-pr1-earn_500',
        }),
      }),
    );
  });
});

describe('PayoutService.processPayout partial approvals', () => {
  it('splits an over-allocated earnings row so only the approved amount can be marked paid', async () => {
    const payoutAccount = {
      id: 'acc1',
      provider: 'manual',
      destination: 'manual-destination',
    };
    const earningsEntry = {
      id: 'earn-1',
      userId: 'u1',
      campaignId: 'camp-1',
      impressionId: 'imp-1',
      clickId: null,
      entryType: 'credit',
      status: 'confirmed',
      amountMinor: 1000n,
      currency: 'USD',
      availableAt: new Date('2026-07-09T00:00:00.000Z'),
      description: 'Original earning',
    };
    const allocation = {
      id: 'alloc-1',
      payoutRequestId: 'payout-1',
      earningsEntryId: earningsEntry.id,
      amountMinor: 1000n,
      earningsEntry,
    };
    const payoutForProcessing = {
      id: 'payout-1',
      userId: 'u1',
      payoutAccount,
      status: 'processing',
      requestedAmountMinor: 1000,
      approvedAmountMinor: 600,
      currency: 'USD',
      allocations: [allocation],
    };

    const payoutRequestFindUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'payout-1', status: 'approved', payoutAccount })
      .mockResolvedValueOnce(payoutForProcessing);

    const { prisma, service } = makePayoutService({
      payoutRequest: {
        findUnique: payoutRequestFindUnique,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      payoutAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        delete: vi.fn(),
        update: vi.fn(),
      },
      earningsLedger: {
        findUnique: vi.fn().mockResolvedValue(earningsEntry),
        update: vi.fn(),
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      payoutTransaction: {
        create: vi.fn().mockResolvedValue({ id: 'ptx-1' }),
      },
    });

    const result = await service.processPayout('payout-1');

    expect(result).toEqual({
      payoutId: 'payout-1',
      providerTxId: 'manual_payout-1',
      status: 'processing',
    });
    expect(prisma.earningsLedger.update).toHaveBeenCalledWith({
      where: { id: earningsEntry.id },
      data: { amountMinor: 600n },
    });
    expect(prisma.earningsLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        amountMinor: 400n,
        status: 'confirmed',
        idempotencyKey: `payout_remainder_payout-1_${earningsEntry.id}`,
      }),
    });
    expect(prisma.payoutAllocation.update).toHaveBeenCalledWith({
      where: { id: allocation.id },
      data: { amountMinor: 600n },
    });
    expect(prisma.payoutAllocation.delete).not.toHaveBeenCalled();
    expect(prisma.payoutTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payoutRequestId: 'payout-1',
        provider: 'manual',
        providerTxId: 'manual_payout-1',
        status: 'processing',
      }),
    });
  });
});
