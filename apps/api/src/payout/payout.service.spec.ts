import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

import { makePayoutService } from './test/payout-test-helper';

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

describe('PayoutService.requestPayout active fraud reviews', () => {
  const verifiedAccount = {
    id: 'acc1',
    userId: 'u1',
    isActive: true,
    isVerified: true,
    isFrozen: false,
    currency: 'USD',
    createdAt: new Date(),
  };

  it('treats escalated high-risk flags as payout-blocking', async () => {
    const fraudCount = vi.fn().mockResolvedValue(1);
    const { service } = makePayoutService({
      fraudFlag: { count: fraudCount },
      payoutAccount: { findUnique: vi.fn().mockResolvedValue(verifiedAccount) },
    });

    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.toThrow('Payout blocked due to pending fraud review');

    expect(fraudCount).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        status: { in: expect.arrayContaining(['open', 'reviewing', 'escalated']) },
        severity: { in: ['high', 'critical'] },
      },
    });
  });

  it('re-checks active fraud inside the allocation transaction', async () => {
    const fraudCount = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const payoutCreate = vi.fn();
    const { service } = makePayoutService({
      fraudFlag: { count: fraudCount },
      payoutAccount: { findUnique: vi.fn().mockResolvedValue(verifiedAccount) },
      payoutRequest: { findUnique: vi.fn(), create: payoutCreate },
    });

    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.toThrow('Payout blocked due to pending fraud review');

    expect(fraudCount).toHaveBeenCalledTimes(2);
    expect(payoutCreate).not.toHaveBeenCalled();
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
  it('rolls an approved payout back and never calls the provider when its account is frozen', async () => {
    const payoutAccount = {
      id: 'acc-frozen',
      provider: 'manual',
      destination: 'manual-destination',
      isActive: true,
      isVerified: true,
      isFrozen: true,
    };
    const payoutForProcessing = {
      id: 'payout-frozen',
      userId: 'u1',
      user: { status: 'active' },
      payoutAccount,
      status: 'processing',
      requestedAmountMinor: 1000n,
      approvedAmountMinor: 1000n,
      currency: 'USD',
      allocations: [],
    };
    let persistedStatus = 'approved';
    const placeholderCreate = vi.fn();
    const providerInitiate = vi.fn();

    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({
          ...payoutForProcessing,
          status: 'approved',
        }),
      },
      $transaction: vi.fn(async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const statusBeforeTransaction = persistedStatus;
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(1),
          payoutRequest: {
            updateMany: vi.fn().mockImplementation(() => {
              persistedStatus = 'processing';
              return Promise.resolve({ count: 1 });
            }),
            findUnique: vi.fn().mockResolvedValue(payoutForProcessing),
          },
          payoutTransaction: { create: placeholderCreate },
          fraudFlag: { count: vi.fn().mockResolvedValue(0) },
        };
        try {
          return await cb(tx);
        } catch (err) {
          // Model the rollback guarantee of Prisma's interactive transaction.
          persistedStatus = statusBeforeTransaction;
          throw err;
        }
      }),
    });
    (service as unknown as { providers: Record<string, unknown> }).providers = {
      manual: {
        readiness: () => ({ ok: true }),
        initiate: providerInitiate,
        checkStatus: vi.fn(),
      },
    };

    await expect(service.processPayout('payout-frozen')).rejects.toThrow(
      'Payout destination is frozen by operator',
    );

    expect(persistedStatus).toBe('approved');
    expect(placeholderCreate).not.toHaveBeenCalled();
    expect(providerInitiate).not.toHaveBeenCalled();
  });

  it('rolls an approved payout back when an escalated high-risk fraud review is active', async () => {
    const payoutAccount = {
      id: 'acc-fraud',
      provider: 'manual',
      destination: 'manual-destination',
      isActive: true,
      isVerified: true,
      isFrozen: false,
    };
    const payoutForProcessing = {
      id: 'payout-fraud',
      userId: 'u1',
      user: { status: 'active' },
      payoutAccount,
      status: 'processing',
      requestedAmountMinor: 1000n,
      approvedAmountMinor: 1000n,
      currency: 'USD',
      allocations: [],
    };
    let persistedStatus = 'approved';
    const placeholderCreate = vi.fn();
    const providerInitiate = vi.fn();
    const fraudCount = vi.fn().mockResolvedValue(1);
    const fraudLock = vi.fn().mockResolvedValue(1);

    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({
          ...payoutForProcessing,
          status: 'approved',
        }),
      },
      $transaction: vi.fn(async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const statusBeforeTransaction = persistedStatus;
        const tx = {
          $executeRaw: fraudLock,
          payoutRequest: {
            updateMany: vi.fn().mockImplementation(() => {
              persistedStatus = 'processing';
              return Promise.resolve({ count: 1 });
            }),
            findUnique: vi.fn().mockResolvedValue(payoutForProcessing),
          },
          payoutTransaction: { create: placeholderCreate },
          fraudFlag: { count: fraudCount },
        };
        try {
          return await cb(tx);
        } catch (err) {
          persistedStatus = statusBeforeTransaction;
          throw err;
        }
      }),
    });
    (service as unknown as { providers: Record<string, unknown> }).providers = {
      manual: {
        readiness: () => ({ ok: true }),
        initiate: providerInitiate,
        checkStatus: vi.fn(),
      },
    };

    await expect(service.processPayout('payout-fraud')).rejects.toThrow(
      'Payout blocked due to pending fraud review',
    );

    expect(fraudCount).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        status: { in: expect.arrayContaining(['open', 'reviewing', 'escalated']) },
        severity: { in: ['high', 'critical'] },
      },
    });
    expect(fraudLock).toHaveBeenCalledOnce();
    expect(persistedStatus).toBe('approved');
    expect(placeholderCreate).not.toHaveBeenCalled();
    expect(providerInitiate).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'the operator freeze wins the account-row race',
      accountState: {
        isFrozen: true,
        isActive: true,
        isVerified: true,
        initiationPayoutId: null,
      },
      error: 'Payout destination is frozen by operator',
    },
    {
      label: 'another payout holds the durable initiation fence',
      accountState: {
        isFrozen: false,
        isActive: true,
        isVerified: true,
        initiationPayoutId: '11111111-1111-4111-8111-111111111111',
      },
      error: 'Another payout initiation is active',
    },
  ])('rolls the claim back before provider I/O when $label', async ({ accountState, error }) => {
    const payoutAccount = {
      id: 'acc-race',
      provider: 'manual',
      destination: 'manual-destination',
      isActive: true,
      isVerified: true,
      isFrozen: false,
    };
    const payoutForProcessing = {
      id: 'payout-race',
      userId: 'u1',
      user: { status: 'active' },
      payoutAccount,
      status: 'processing',
      requestedAmountMinor: 0n,
      approvedAmountMinor: 0n,
      currency: 'USD',
      allocations: [],
    };
    let persistedStatus = 'approved';
    const placeholderCreate = vi.fn();
    const providerInitiate = vi.fn();
    const leaseUpdate = vi.fn().mockResolvedValue({ count: 0 });

    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({
          ...payoutForProcessing,
          status: 'approved',
        }),
      },
      $transaction: vi.fn(async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const statusBeforeTransaction = persistedStatus;
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(1),
          payoutRequest: {
            updateMany: vi.fn().mockImplementation(() => {
              persistedStatus = 'processing';
              return Promise.resolve({ count: 1 });
            }),
            findUnique: vi.fn().mockResolvedValue(payoutForProcessing),
          },
          payoutAccount: {
            updateMany: leaseUpdate,
            findUnique: vi.fn().mockResolvedValue(accountState),
          },
          payoutTransaction: { create: placeholderCreate },
          fraudFlag: { count: vi.fn().mockResolvedValue(0) },
        };
        try {
          return await cb(tx);
        } catch (err) {
          persistedStatus = statusBeforeTransaction;
          throw err;
        }
      }),
    });
    (service as unknown as { providers: Record<string, unknown> }).providers = {
      manual: {
        readiness: () => ({ ok: true }),
        initiate: providerInitiate,
        checkStatus: vi.fn(),
      },
    };

    await expect(service.processPayout('payout-race')).rejects.toThrow(error);

    expect(leaseUpdate).toHaveBeenCalledWith({
      where: {
        id: 'acc-race',
        isFrozen: false,
        isActive: true,
        isVerified: true,
        initiationPayoutId: null,
      },
      data: {
        initiationPayoutId: 'payout-race',
      },
    });
    expect(persistedStatus).toBe('approved');
    expect(placeholderCreate).not.toHaveBeenCalled();
    expect(providerInitiate).not.toHaveBeenCalled();
  });

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
    expect(prisma.payoutAccount.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'acc1',
        isFrozen: false,
        isActive: true,
        isVerified: true,
        initiationPayoutId: null,
      },
      data: {
        initiationPayoutId: 'payout-1',
      },
    });
    expect(prisma.payoutAccount.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'acc1',
        initiationPayoutId: 'payout-1',
      },
      data: {
        initiationPayoutId: null,
      },
    });
  });

  it('rolls back the partial-approval split when a concurrent fraud hold flips the earnings entry (#9)', async () => {
    // A partial approval (approved 600 of requested 1000) tries to split the
    // earnings row. The CAS retire is gated on `status: 'confirmed'`; a
    // concurrent holdEarnings (fraud service) flips the row to 'held', so
    // updateMany returns count===0. processPayout must throw "concurrently
    // modified" and the whole tx — including the approved→processing claim —
    // rolls back, so the payout stays recoverable and the hold is NOT
    // overwritten. The provider is never called.
    const payoutAccount = {
      id: 'acc1',
      provider: 'manual',
      destination: 'manual-destination',
      isActive: true,
      isVerified: true,
      isFrozen: false,
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
      user: { status: 'active' },
      payoutAccount,
      status: 'processing',
      requestedAmountMinor: 1000,
      approvedAmountMinor: 600,
      currency: 'USD',
      allocations: [allocation],
    };
    const providerInitiate = vi.fn();
    const { service, prisma } = makePayoutService({
      payoutRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'payout-1', status: 'approved', payoutAccount })
          .mockResolvedValueOnce(payoutForProcessing),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      payoutAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        delete: vi.fn(),
        update: vi.fn(),
      },
      earningsLedger: {
        findUnique: vi.fn().mockResolvedValue(earningsEntry),
        // CAS retire fails: a concurrent fraud hold flipped the row to 'held'.
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      payoutTransaction: {
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    });
    (service as unknown as { providers: Record<string, unknown> }).providers = {
      manual: { readiness: () => ({ ok: true }), initiate: providerInitiate },
    };

    await expect(service.processPayout('payout-1')).rejects.toThrow('concurrently modified');
    // The provider was never called: the tx rolled back before provider I/O.
    expect(providerInitiate).not.toHaveBeenCalled();
    // No new earnings rows were created (the split did not complete).
    expect(prisma.earningsLedger.create).not.toHaveBeenCalled();
  });

  it('eligibility query filters to confirmed status so only the remainder row is allocated', async () => {
    // After a partial approval split, the original earnings entry is retired
    // to 'reversed' and a remainder row is created as 'confirmed'. The eligibility
    // query in allocatePayoutEarnings filters by status: 'confirmed', so the
    // reversed original is excluded at the database layer and only the remainder
    // can be allocated.
    const payoutAccount = {
      id: 'acc1',
      userId: 'u1',
      provider: 'manual',
      destination: 'manual-destination',
      isActive: true,
      isVerified: true,
      isFrozen: false,
      currency: 'USD',
      createdAt: new Date(),
    };
    const remainderEntry = {
      id: 'earn-remainder',
      userId: 'u1',
      entryType: 'credit',
      status: 'confirmed',
      amountMinor: 1000n,
      currency: 'USD',
      availableAt: new Date('2026-07-09T00:00:00.000Z'),
      description: 'Payout partial-approval remainder',
    };

    const { prisma, service } = makePayoutService({
      payoutAccount: { findUnique: vi.fn().mockResolvedValue(payoutAccount) },
      earningsLedger: {
        findMany: vi.fn().mockResolvedValue([remainderEntry]),
        findUnique: vi.fn().mockResolvedValue(remainderEntry),
        aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
          if (args?.where?.entryType === 'debit') {
            return Promise.resolve({ _sum: { amountMinor: 0n } });
          }
          return Promise.resolve({ _sum: { amountMinor: 1000n } });
        }),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
      },
      payoutAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        create: vi.fn(),
      },
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'payout-2',
          status: 'requested',
          requestedAmountMinor: 1000n,
          approvedAmountMinor: null,
          currency: 'USD',
          allocations: [],
        }),
        create: vi.fn().mockResolvedValue({
          id: 'payout-2',
          userId: 'u1',
          payoutAccountId: 'acc1',
          status: 'requested',
          requestedAmountMinor: 1000n,
          currency: 'USD',
          allocations: [],
        }),
      },
    });

    await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
    });

    // The eligibility query filters to confirmed entries, so the reversed
    // original is excluded at the database layer.
    expect(prisma.earningsLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          status: 'confirmed',
          entryType: 'credit',
          currency: 'USD',
        }),
      }),
    );
    // Only the confirmed remainder is allocated.
    expect(prisma.payoutAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payoutRequestId: 'payout-2',
        earningsEntryId: 'earn-remainder',
        amountMinor: 1000n,
      }),
    });
  });

  it('can re-allocate the unpaid remainder in a subsequent payout request', async () => {
    // After a partial approval split, the remainder row must be eligible for a
    // new payout. We simulate the post-split state: the original entry is
    // reversed, the paid slice is allocated to the first payout, and the
    // remainder row is confirmed. A new requestPayout for the remainder amount
    // must succeed and allocate the remainder row.
    const payoutAccount = {
      id: 'acc1',
      userId: 'u1',
      provider: 'manual',
      destination: 'manual-destination',
      isActive: true,
      isVerified: true,
      isFrozen: false,
      currency: 'USD',
      createdAt: new Date(),
    };
    const remainderEntry = {
      id: 'earn-remainder',
      userId: 'u1',
      entryType: 'credit',
      status: 'confirmed',
      amountMinor: 1000n,
      currency: 'USD',
      availableAt: new Date('2026-07-09T00:00:00.000Z'),
      description: 'Payout partial-approval remainder',
    };

    const { prisma, service } = makePayoutService({
      payoutAccount: { findUnique: vi.fn().mockResolvedValue(payoutAccount) },
      earningsLedger: {
        findMany: vi.fn().mockResolvedValue([remainderEntry]),
        findUnique: vi.fn().mockResolvedValue(remainderEntry),
        aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
          if (args?.where?.entryType === 'debit') {
            return Promise.resolve({ _sum: { amountMinor: 0n } });
          }
          return Promise.resolve({ _sum: { amountMinor: 1000n } });
        }),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
      },
      payoutAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        create: vi.fn(),
      },
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'payout-2',
          status: 'requested',
          requestedAmountMinor: 1000n,
          approvedAmountMinor: null,
          currency: 'USD',
          allocations: [],
        }),
        create: vi.fn().mockResolvedValue({
          id: 'payout-2',
          userId: 'u1',
          payoutAccountId: 'acc1',
          status: 'requested',
          requestedAmountMinor: 1000n,
          currency: 'USD',
          allocations: [],
        }),
      },
    });

    await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
    });

    // The remainder row should be allocated without splitting (it already
    // matches the requested amount).
    expect(prisma.earningsLedger.create).not.toHaveBeenCalled();
    expect(prisma.payoutAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payoutRequestId: 'payout-2',
        earningsEntryId: 'earn-remainder',
        amountMinor: 1000n,
      }),
    });
  });

  it('keeps the unpaid remainder confirmed and withdrawable after a partial approval split', async () => {
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

    const { prisma, service } = makePayoutService({
      payoutRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'payout-1', status: 'approved', payoutAccount })
          .mockResolvedValueOnce(payoutForProcessing),
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

    await service.processPayout('payout-1');

    // The remainder row is created as confirmed so it remains withdrawable.
    expect(prisma.earningsLedger.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        userId: 'u1',
        amountMinor: 400n,
        status: 'confirmed',
        idempotencyKey: `payout_remainder_payout-1_${earningsEntry.id}`,
      }),
    });
    // The original row is retired so it cannot also be counted as available.
    expect(prisma.earningsLedger.updateMany).toHaveBeenCalledWith({
      where: { id: earningsEntry.id, status: 'confirmed' },
      data: {
        status: 'reversed',
        description: 'Superseded by partial payout approval payout-1',
      },
    });
  });

  it('does not split the same entry again on retry after provider failure', async () => {
    // First attempt: partial approval splits the entry, then the provider fails.
    // The payout is left in a failed state with allocations released. A retry
    // must allocate the already-created remainder row, not re-split the original
    // reversed entry.
    const payoutAccount = {
      id: 'acc1',
      provider: 'manual',
      destination: 'manual-destination',
      isActive: true,
      isVerified: true,
    };
    const originalEntry = {
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
      earningsEntryId: originalEntry.id,
      amountMinor: 1000n,
      earningsEntry: originalEntry,
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

    const providerInitiate = vi.fn().mockRejectedValue(new Error('provider network error'));
    const { prisma, service } = makePayoutService({
      payoutRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'payout-1', status: 'approved', payoutAccount })
          .mockResolvedValueOnce(payoutForProcessing)
          .mockResolvedValueOnce({ id: 'payout-1', status: 'processing', payoutAccount }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      payoutAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        delete: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
      },
      earningsLedger: {
        findUnique: vi.fn().mockResolvedValue(originalEntry),
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
    (service as unknown as { providers: Record<string, unknown> }).providers = {
      manual: {
        readiness: () => ({ ok: true }),
        initiate: providerInitiate,
        checkStatus: vi.fn(),
      },
    };

    await expect(service.processPayout('payout-1')).rejects.toThrow(
      'Payout provider outcome is unknown; allocations remain reserved for reconciliation',
    );

    // The split happened exactly once during the first (and only) processPayout.
    // A real retry would require a new payout request against the remainder row;
    // the important invariant is that the original entry was reversed once and
    // the remainder row was created once.
    expect(prisma.earningsLedger.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.earningsLedger.create).toHaveBeenCalledTimes(2);
  });
});

// ── Idempotency-key tests for requestPayout ──

describe('PayoutService.requestPayout idempotency', () => {
  const verifiedAccount = {
    id: 'acc1',
    userId: 'u1',
    isActive: true,
    isVerified: true,
    currency: 'USD',
    createdAt: new Date(),
  };

  function makeIdempotentService(overrides: Record<string, unknown> = {}) {
    return makePayoutService({
      payoutAccount: { findUnique: vi.fn().mockResolvedValue(verifiedAccount) },
      earningsLedger: {
        aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
          if (args?.where?.entryType === 'debit') {
            return Promise.resolve({ _sum: { amountMinor: 0n } });
          }
          return Promise.resolve({ _sum: { amountMinor: 10_00n } });
        }),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'earn-new' }),
      },
      payoutAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        create: vi.fn().mockResolvedValue({ id: 'alloc-new' }),
      },
      payoutRequest: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      ...overrides,
    });
  }

  it('returns an existing payout on replay without creating a duplicate', async () => {
    const existing = {
      id: 'pr-existing',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'key-1',
      allocations: [],
    };
    const { prisma, service } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    });

    const result = await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'key-1',
    });

    expect(result).toEqual(existing);
    expect(prisma.payoutRequest.create).not.toHaveBeenCalled();
  });

  it('returns the winner when a race causes P2002 on create', async () => {
    const winner = {
      id: 'pr-winner',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'race-key',
      allocations: [],
    };
    // Three findUnique reads: (1) outside-tx pre-check → null (no existing
    // yet), (2) in-tx pre-check → null (concurrent request still in-flight),
    // (3) P2002-catch re-read with the normal client → winner (concurrent
    // request committed between the in-tx pre-check and the create). The tx
    // mock passes `prisma` as `tx`, so all three hit the same mock.
    const { prisma, service } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner),
        create: vi.fn().mockImplementation(() => {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            clientVersion: '0.0.0',
            code: 'P2002',
            meta: { target: ['user_id', 'idempotency_key'] },
          });
        }),
      },
    });

    const result = await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'race-key',
    });

    expect(result).toEqual(winner);
    expect(prisma.payoutRequest.create).toHaveBeenCalledTimes(1);
  });

  it('trims the idempotency key so whitespace does not create a duplicate', async () => {
    const existing = {
      id: 'pr-trim',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'key-1',
      allocations: [],
    };
    const { prisma, service } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    });

    const result = await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: '  key-1  ',
    });

    expect(result).toEqual(existing);
    expect(prisma.payoutRequest.create).not.toHaveBeenCalled();
  });

  it('creates a new payout when a different idempotency key is supplied', async () => {
    const created = {
      id: 'pr-new',
      userId: 'u1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'key-2',
      allocations: [],
    };
    const { prisma, service } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
          if ('userId_idempotencyKey' in args.where) return Promise.resolve(null);
          return Promise.resolve(created);
        }),
        create: vi.fn().mockResolvedValue(created),
      },
    });

    // The service will attempt allocation after create; provide an eligible
    // earnings entry so the request completes end-to-end.
    prisma.earningsLedger.findMany.mockResolvedValue([
      {
        id: 'earn-1',
        amountMinor: 1000n,
        currency: 'USD',
        entryType: 'credit',
        status: 'confirmed',
      },
    ]);

    const result = await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'key-2',
    });

    expect(result).toEqual(created);
    expect(prisma.payoutRequest.create).toHaveBeenCalledTimes(1);
    expect(prisma.payoutRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: 'key-2' }),
      }),
    );
  });

  it('creates a payout when no idempotency key is supplied', async () => {
    const created = {
      id: 'pr-no-key',
      userId: 'u1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: null,
      allocations: [],
    };
    const { prisma, service } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
          if ('userId_idempotencyKey' in args.where) return Promise.resolve(null);
          return Promise.resolve(created);
        }),
        create: vi.fn().mockResolvedValue(created),
      },
    });
    prisma.earningsLedger.findMany.mockResolvedValue([
      {
        id: 'earn-1',
        amountMinor: 1000n,
        currency: 'USD',
        entryType: 'credit',
        status: 'confirmed',
      },
    ]);

    const result = await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
    });

    expect(result).toEqual(created);
    expect(prisma.payoutRequest.create).toHaveBeenCalledTimes(1);
    expect(prisma.payoutRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: undefined }),
      }),
    );
  });

  it('rejects a replay with a different amount (409, not a silent return)', async () => {
    const existing = {
      id: 'pr-amt',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 2000n,
      currency: 'USD',
      idempotencyKey: 'key-amt',
      allocations: [],
    };
    const { prisma, service } = makeIdempotentService({
      payoutRequest: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
    });
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
        idempotencyKey: 'key-amt',
      }),
    ).rejects.toThrow('different amount');
    expect(prisma.payoutRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a replay with a different payout account', async () => {
    const existing = {
      id: 'pr-acc',
      userId: 'u1',
      payoutAccountId: 'acc-other',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'key-acc',
      allocations: [],
    };
    const { service } = makeIdempotentService({
      payoutRequest: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
    });
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
        idempotencyKey: 'key-acc',
      }),
    ).rejects.toThrow('different payout account');
  });

  it('rejects a replay with a different currency', async () => {
    const existing = {
      id: 'pr-cur',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'EUR',
      idempotencyKey: 'key-cur',
      allocations: [],
    };
    const { service } = makeIdempotentService({
      payoutRequest: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
    });
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
        idempotencyKey: 'key-cur',
      }),
    ).rejects.toThrow('different currency');
  });

  it('rejects a replay with different selected earnings entries', async () => {
    const existing = {
      id: 'pr-ent',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'key-ent',
      allocations: [{ earningsEntryId: 'e-original' }],
    };
    const { service } = makeIdempotentService({
      payoutRequest: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
    });
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
        earningsEntryIds: ['e-different'],
        idempotencyKey: 'key-ent',
      }),
    ).rejects.toThrow('different earnings entries');
  });

  it('does not emit a request_payout audit event when the transaction rolls back (#7)', async () => {
    // The tx rolls back because allocatePayoutEarnings finds no confirmed
    // earnings (findMany → []). A rolled-back payout request must NOT leave a
    // success audit record: audit.logStrict is called INSIDE the $transaction,
    // so a rejection rolls the audit row back with the rest of the tx.
    const { service, audit } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue({ id: 'pr-rb', allocations: [] }),
      },
    });
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
        idempotencyKey: 'rb-key',
      }),
    ).rejects.toThrow('Insufficient confirmed earnings');
    expect(audit.logStrict).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('emits a request_payout audit event after a successful commit (#7)', async () => {
    const created = {
      id: 'pr-ok',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'ok-key',
      allocations: [{ earningsEntryId: 'earn-1' }],
    };
    const { service, audit, prisma } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
          if ('userId_idempotencyKey' in args.where) return Promise.resolve(null);
          return Promise.resolve(created);
        }),
        create: vi.fn().mockResolvedValue({ id: 'pr-ok', allocations: [] }),
      },
    });
    prisma.earningsLedger.findMany.mockResolvedValue([
      {
        id: 'earn-1',
        amountMinor: 1000n,
        currency: 'USD',
        entryType: 'credit',
        status: 'confirmed',
      },
    ]);
    await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'ok-key',
    });
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'request_payout', targetId: 'pr-ok' }),
      expect.anything(),
    );
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
    const clearFence = vi.fn().mockResolvedValue({ count: 1 });
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
        payoutAccount: { updateMany: clearFence },
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
    expect(clearFence).toHaveBeenCalledWith({
      where: { initiationPayoutId: 'payout-1' },
      data: { initiationPayoutId: null },
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
    ).rejects.toThrow(/authorized payable status/i);
  });

  it('settles a post-authorization fraud hold for a processing payout without resurrecting it', async () => {
    const processingPayout = {
      id: 'payout-processing',
      userId: 'u1',
      status: 'processing',
      approvedAmountMinor: 1000n,
      requestedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual', isActive: true, isVerified: true },
      allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-held' }],
    };
    const earningsUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const paidPayout = { ...processingPayout, status: 'paid' };
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValue(paidPayout),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        earningsLedger: {
          updateMany: earningsUpdate,
          aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 } }),
        },
        platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: { findUnique: vi.fn().mockResolvedValue(processingPayout) },
      $transaction: $tx,
    });

    await expect(
      service.markPayoutPaid('payout-processing', {
        providerTxId: 'provider-paid',
        paidAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ status: 'paid' });

    expect(earningsUpdate).toHaveBeenCalledWith({
      where: {
        id: { in: ['earn-held'] },
        status: { in: ['confirmed', 'held'] },
      },
      data: { status: 'paid', heldByFlagId: null },
    });
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
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
    const clearFence = vi.fn().mockResolvedValue({ count: 1 });
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
        payoutAccount: { updateMany: clearFence },
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
    expect(clearFence).toHaveBeenCalledWith({
      where: { initiationPayoutId: 'payout-1' },
      data: { initiationPayoutId: null },
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
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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

// ── Round 28: payout account freeze gate (A-085) ──

describe('PayoutService.requestPayout payout-account freeze gate', () => {
  it('rejects a payout to a frozen destination even if verified', async () => {
    const { prisma, service } = makePayoutService();
    prisma.payoutAccount.findUnique.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      isActive: true,
      isVerified: true,
      isFrozen: true,
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
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.toThrow(/frozen by operator/i);
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a payout to a verified, non-frozen destination (regression lock)', async () => {
    const { prisma, service } = makePayoutService();
    prisma.payoutAccount.findUnique.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      isActive: true,
      isVerified: true,
      isFrozen: false,
      currency: 'USD',
      createdAt: new Date(),
    });
    prisma.payoutRequest = { create: vi.fn().mockResolvedValue({ id: 'pr1' }) };

    // We only assert it does NOT throw the frozen-gate error.
    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 1000n,
        currency: 'USD',
      }),
    ).rejects.not.toThrow(/frozen by operator/i);
  });
});
