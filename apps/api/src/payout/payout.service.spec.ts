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
  const referral = { processReferralRewards: vi.fn().mockResolvedValue(undefined) };
  const runtimeConfig = {
    isPayoutRequestsEnabled: vi.fn().mockResolvedValue(true),
    isProviderEnabled: vi.fn().mockResolvedValue(true),
    isCurrencyAllowed: vi.fn().mockResolvedValue(true),
  };
  const service = new PayoutService(
    prisma as never,
    {} as LedgerService,
    referral as unknown as ReferralService,
    { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    config,
    {} as never,
    {} as never,
    {} as never,
    runtimeConfig as never,
  );
  return { prisma, service };
}

describe('PayoutService.requestPayout payout-account verification', () => {
  it('rejects a payout to an unverified destination', async () => {
    const { prisma, service } = makePayoutService();
    prisma.payoutAccount.findUnique.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      isActive: true,
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
      isActive: true,
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
      isActive: true,
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
    isActive: true,
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
      isActive: true,
      isVerified: true,
    };
    const earningsEntry = {
      id: 'earn-1',
      userId: 'u1',
      user: { status: 'active' },
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
      user: { status: 'active' },
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'earn-paid-slice' })
          .mockResolvedValueOnce({ id: 'earn-remainder' }),
        count: vi.fn().mockResolvedValue(0),
      },
      payoutTransaction: {
        create: vi.fn().mockResolvedValue({ id: 'ptx-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const result = await service.processPayout('payout-1');

    expect(result).toEqual({
      payoutId: 'payout-1',
      providerTxId: 'manual_payout-1',
      status: 'processing',
    });
    expect(prisma.earningsLedger.updateMany).toHaveBeenCalledWith({
      where: { id: earningsEntry.id, status: 'confirmed' },
      data: {
        status: 'reversed',
        description: 'Superseded by partial payout approval payout-1',
      },
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
      data: { amountMinor: 600n, earningsEntryId: 'earn-paid-slice' },
    });
    expect(prisma.payoutAllocation.delete).not.toHaveBeenCalled();
    expect(prisma.payoutTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payoutRequestId: 'payout-1',
        provider: 'manual',
        providerTxId: 'initiate_pending_payout-1',
        status: 'processing',
      }),
    });
  });
});

// ── Round 27 Fix 8: markPayoutPaid/markPayoutFailed direct unit tests ──
// These two terminal state transitions are the highest-stakes mutations in the
// payout state machine; prior to this round they had no direct unit coverage
// and were tested only indirectly via e2e + cron (mocked trait wholesale) +
// stripe webhook spec (narrow happy-path only).

describe('markPayoutPaid terminal state transition', () => {
  it('CAS-flips payoutRequest from approved/processing and asserts the where clause', async () => {
    const payoutPaid = {
      id: 'payout-1',
      userId: 'u1',
      status: 'approved',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual', isActive: true, isVerified: true },
      allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(payoutPaid),
          updateMany,
          update: vi.fn(),
          findFirst: vi.fn(),
        },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        earningsLedger: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 } }),
        },
        platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
        payoutAllocation: { updateMany: vi.fn(), deleteMany: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(payoutPaid),
        updateMany,
        // Provide a model-level findUnique (as distinct from the tx-level one)
        // so the idempotent path / post-tx re-read works.
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      payoutTransaction: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      earningsLedger: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 } }),
      },
      platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
      $transaction: $tx,
    });

    await service.markPayoutPaid('payout-1', {
      providerTxId: 'pp_tx_1',
      paidAt: new Date().toISOString(),
      expectedAmountMinor: 1000n,
      expectedCurrency: 'usd',
    });

    // The CAS clause is the TOCTOU guard; assert it exactly.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'payout-1', status: { in: ['approved', 'processing'] } },
      data: expect.objectContaining({ status: 'paid' }),
    });
  });

  it('rejects amount cross-check mismatch when expectedAmountMinor is supplied (Fix 2 regression lock)', async () => {
    const payout = {
      id: 'payout-1',
      status: 'approved',
      approvedAmountMinor: 5000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual' },
      allocations: [],
    };
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(payout),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    });

    await expect(() =>
      service.markPayoutPaid('payout-1', {
        providerTxId: 'pp_tx_1',
        paidAt: new Date().toISOString(),
        expectedAmountMinor: 4000n, // wrong — stored is 5000n
        expectedCurrency: 'usd',
      }),
    ).rejects.toThrow(/amount mismatch/i);
  });

  it('rejects when allocated earnings entries are concurrently held and rolls back the paid transition', async () => {
    const payout = {
      id: 'payout-1',
      userId: 'u1',
      status: 'approved',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual', isActive: true, isVerified: true },
      allocations: [
        { id: 'alloc-1', earningsEntryId: 'earn-1' },
        { id: 'alloc-2', earningsEntryId: 'earn-2' },
      ],
    };
    // Two earnings entries, but only one gets marked paid (the other was held).
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        earningsLedger: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 } }), // only 1 of 2 was paid
        },
        platformLedger: { upsert: vi.fn() },
        payoutAllocation: { updateMany: vi.fn(), deleteMany: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(payout),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      payoutTransaction: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      earningsLedger: {
        updateMany: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 } }),
      },
      $transaction: $tx,
    });

    await expect(() =>
      service.markPayoutPaid('payout-1', {
        providerTxId: 'pp_tx_1',
        paidAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/no longer in 'confirmed' status/i);
  });

  it('returns the payout idempotently when already paid with PayoutTransaction already in paid status', async () => {
    const alreadyPaid = {
      id: 'payout-1',
      userId: 'u1',
      status: 'paid',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual', isActive: true, isVerified: true },
      allocations: [],
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValue(alreadyPaid),
          updateMany,
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutTransaction: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        earningsLedger: { updateMany: vi.fn(), aggregate: vi.fn() },
        platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
        payoutAllocation: { updateMany: vi.fn(), deleteMany: vi.fn() },
      }),
    );
    // The pre-tx findUnique returns 'approved' so the method enters the tx path
    // (status !== 'paid'); but inside the tx the CAS returns count 0 because
    // a concurrent caller already flipped it to 'paid' — and the tx re-read
    // returns `paid`. The inner tx path should short-circuit and return the
    // already-paid record.
    const preTx = {
      ...alreadyPaid,
      status: 'approved' as const,
      allocations: [],
    };
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(preTx),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      payoutTransaction: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      earningsLedger: { updateMany: vi.fn(), aggregate: vi.fn() },
      platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
      $transaction: $tx,
    });

    const result = await service.markPayoutPaid('payout-1', {
      providerTxId: 'pp_tx_1',
      paidAt: new Date().toISOString(),
    });
    expect(result.status).toBe('paid');
  });

  it('creates a PayoutTransaction when no existing transaction row is found (missing-tx branch)', async () => {
    const payout = {
      id: 'payout-1',
      userId: 'u1',
      status: 'approved',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual', isActive: true, isVerified: true },
      allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
    };
    // No existing PayoutTransaction — verify we create one + don't double-insert.
    const txCreate = vi.fn().mockResolvedValue({ id: 'ptx-new' });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(payout),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findFirst: vi.fn().mockResolvedValue(null),
          create: txCreate,
        },
        earningsLedger: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 } }),
        },
        platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
        payoutAllocation: { updateMany: vi.fn(), deleteMany: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(payout),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      payoutTransaction: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      earningsLedger: {
        updateMany: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 } }),
      },
      platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
      $transaction: $tx,
    });

    await service.markPayoutPaid('payout-1', {
      providerTxId: 'pp_tx_2',
      paidAt: new Date().toISOString(),
    });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(txCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerTxId: 'pp_tx_2',
        status: 'paid',
      }),
    });
  });
});

describe('markPayoutFailed terminal state transition', () => {
  it('CAS-flips payoutRequest from approved/processing and asserts the where clause', async () => {
    const payout = {
      id: 'payout-1',
      status: 'approved',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual' },
      allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(payout),
          updateMany,
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        payoutAllocation: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          updateMany: vi.fn(),
        },
        earningsLedger: { updateMany: vi.fn(), aggregate: vi.fn() },
        platformLedger: { upsert: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(payout),
        updateMany,
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      payoutTransaction: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      payoutAllocation: { deleteMany: vi.fn() },
      $transaction: $tx,
    });

    await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'pp_tx_1',
      failureReason: 'Provider declined',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'payout-1', status: { in: ['approved', 'processing'] } },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('returns idempotently when payout is already failed', async () => {
    const alreadyFailed = {
      id: 'payout-1',
      status: 'failed',
      allocations: [],
      payoutAccount: { provider: 'manual' },
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValue(alreadyFailed),
          updateMany,
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutTransaction: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        payoutAllocation: { deleteMany: vi.fn(), updateMany: vi.fn() },
        earningsLedger: { updateMany: vi.fn(), aggregate: vi.fn() },
        platformLedger: { upsert: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({ ...alreadyFailed }),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      payoutTransaction: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      payoutAllocation: { deleteMany: vi.fn() },
      $transaction: $tx,
    });

    const result = await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'pp_tx_1',
      failureReason: 'Duplicate delivery',
    });
    expect(result.status).toBe('failed');
  });

  it('deletes payout allocations to free confirmed earnings for a new request', async () => {
    const payout = {
      id: 'payout-1',
      status: 'processing',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual' },
      allocations: [
        { id: 'alloc-1', earningsEntryId: 'earn-1' },
        { id: 'alloc-2', earningsEntryId: 'earn-2' },
      ],
    };
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(payout),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        payoutAllocation: { deleteMany, updateMany: vi.fn() },
        earningsLedger: { updateMany: vi.fn(), aggregate: vi.fn() },
        platformLedger: { upsert: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(payout),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      payoutTransaction: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      payoutAllocation: { deleteMany: vi.fn() },
      $transaction: $tx,
    });

    await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'pp_tx_1',
      failureReason: 'Provider declined',
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { payoutRequestId: 'payout-1' } });
  });
});
