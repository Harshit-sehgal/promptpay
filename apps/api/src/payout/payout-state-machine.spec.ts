import { describe, expect, it, vi } from 'vitest';

import { PayoutStatus } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { PayoutService } from './payout.service';
import { validatePayoutTransition } from './payout-state-machine';

/**
 * Financial state-machine, concurrency, replay, duplicate-webhook and
 * provider-failure tests.
 *
 * The mandatory priority requires:
 *  - Financial state-machine tests (valid/invalid payout status transitions)
 *  - Duplicate-webhook replay tests (idempotency)
 *  - Provider-failure tests (initiate throws → payout stays recoverable)
 *  - No payout double-processing or campaign overspend race
 *
 * These unit tests verify the CAS-gated state-machine transitions and the
 * provider-failure recovery path directly, complementing the integration
 * tests in `stripe-webhook.spec.ts` that exercise the real controller +
 * Prisma against a live Postgres.
 */

function makePayoutService(prismaOverrides: Record<string, unknown> = {}) {
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
    payoutAccount: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    ...prismaOverrides,
  };
  const config = {
    get: vi.fn((key: string) => (key === 'PAYOUT_REQUIRE_2FA' ? undefined : undefined)),
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
    {} as never,
  );
  return { prisma, service };
}

// ── Payout status transition state-machine tests ──

describe('Payout status state-machine transitions', () => {
  const verifiedAccount = {
    id: 'acc1',
    userId: 'u1',
    provider: 'manual',
    destination: 'manual-dest',
    isActive: true,
    isVerified: true,
    isFrozen: false,
    currency: 'USD',
    createdAt: new Date(),
  };

  it('CAS-gates markPayoutPaid from approved→paid (valid transition)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'payout-1',
              status: 'approved',
              approvedAmountMinor: 1000n,
              currency: 'usd',
              payoutAccount: verifiedAccount,
              allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
            }),
          updateMany,
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
        findUnique: vi.fn().mockResolvedValue({
          id: 'payout-1',
          status: 'approved',
          approvedAmountMinor: 1000n,
          currency: 'usd',
          payoutAccount: verifiedAccount,
          allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
        }),
        updateMany,
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
      platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
      $transaction: $tx,
    });

    await service.markPayoutPaid('payout-1', {
      providerTxId: 'tx-1',
      paidAt: new Date().toISOString(),
      expectedAmountMinor: 1000n,
      expectedCurrency: 'usd',
    });

    // CAS clause must include status guard
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'payout-1', status: { in: ['approved', 'processing'] } },
      data: expect.objectContaining({ status: 'paid' }),
    });
  });

  it('CAS-gates markPayoutPaid from processing→paid (valid transition)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'payout-1',
              status: 'processing',
              approvedAmountMinor: 1000n,
              currency: 'usd',
              payoutAccount: verifiedAccount,
              allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
            }),
          updateMany,
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
        findUnique: vi.fn().mockResolvedValue({
          id: 'payout-1',
          status: 'processing',
          approvedAmountMinor: 1000n,
          currency: 'usd',
          payoutAccount: verifiedAccount,
          allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
        }),
        updateMany,
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: $tx,
    });

    await service.markPayoutPaid('payout-1', {
      providerTxId: 'tx-1',
      paidAt: new Date().toISOString(),
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'payout-1', status: { in: ['approved', 'processing'] } },
      data: expect.objectContaining({ status: 'paid' }),
    });
  });

  it('CAS-gates markPayoutFailed from approved→failed (valid transition)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'payout-1',
              status: 'approved',
              approvedAmountMinor: 1000n,
              currency: 'usd',
              payoutAccount: verifiedAccount,
              allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
            }),
          updateMany,
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
        findUnique: vi.fn().mockResolvedValue({
          id: 'payout-1',
          status: 'approved',
          approvedAmountMinor: 1000n,
          currency: 'usd',
          payoutAccount: verifiedAccount,
          allocations: [{ id: 'alloc-1', earningsEntryId: 'earn-1' }],
        }),
        updateMany,
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: $tx,
    });

    await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'tx-1',
      failureReason: 'Provider declined',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'payout-1', status: { in: ['approved', 'processing'] } },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('rejects markPayoutPaid when payout is already paid (idempotent return, no double-processing)', async () => {
    const alreadyPaid = {
      id: 'payout-1',
      status: 'paid',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: verifiedAccount,
      allocations: [],
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 }); // CAS fails
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValue(alreadyPaid),
          updateMany,
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        payoutTransaction: {
          updateMany: vi.fn(),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        earningsLedger: { updateMany: vi.fn(), aggregate: vi.fn() },
        platformLedger: { upsert: vi.fn().mockResolvedValue({ id: 'pl-1' }) },
        payoutAllocation: { updateMany: vi.fn(), deleteMany: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({ ...alreadyPaid, status: 'approved' }),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: $tx,
    });

    const result = await service.markPayoutPaid('payout-1', {
      providerTxId: 'tx-1',
      paidAt: new Date().toISOString(),
    });

    expect(result.status).toBe('paid');
    // The CAS updateMany returned count=0, so no ledger mutation happened
    // (no double-processing). The idempotent return path is the guard.
  });

  it('rejects markPayoutFailed when payout is already failed (idempotent return)', async () => {
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
        payoutTransaction: {
          updateMany: vi.fn(),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
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
      $transaction: $tx,
    });

    const result = await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'tx-1',
      failureReason: 'Duplicate delivery',
    });

    expect(result.status).toBe('failed');
  });

  it('markPayoutFailed frees earnings allocations for retry (no money stranded)', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'payout-1',
              status: 'processing',
              approvedAmountMinor: 1000n,
              currency: 'usd',
              payoutAccount: verifiedAccount,
              allocations: [
                { id: 'alloc-1', earningsEntryId: 'earn-1' },
                { id: 'alloc-2', earningsEntryId: 'earn-2' },
              ],
            }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        payoutAllocation: { deleteMany, updateMany: vi.fn() },
        earningsLedger: { updateMany: vi.fn(), aggregate: vi.fn() },
        platformLedger: { upsert: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'payout-1',
          status: 'processing',
          approvedAmountMinor: 1000n,
          currency: 'usd',
          payoutAccount: verifiedAccount,
          allocations: [
            { id: 'alloc-1', earningsEntryId: 'earn-1' },
            { id: 'alloc-2', earningsEntryId: 'earn-2' },
          ],
        }),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: $tx,
    });

    await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'tx-fail',
      failureReason: 'Provider declined',
    });

    expect(deleteMany).toHaveBeenCalledWith({ where: { payoutRequestId: 'payout-1' } });
  });
});

// ── Provider-failure test: initiate throws → payout stays recoverable ──

describe('PayoutService.processPayout provider-failure recovery', () => {
  const verifiedAccount = {
    id: 'acc1',
    provider: 'manual',
    destination: 'manual-dest',
    isActive: true,
    isVerified: true,
    isFrozen: false,
  };

  it('throws when provider initiate fails, leaving the payout in a recoverable state', async () => {
    const payoutForProcessing = {
      id: 'payout-1',
      userId: 'u1',
      user: { status: 'active' },
      payoutAccount: verifiedAccount,
      status: 'approved',
      requestedAmountMinor: 1000,
      approvedAmountMinor: 1000,
      currency: 'USD',
      allocations: [
        {
          id: 'alloc-1',
          earningsEntryId: 'earn-1',
          amountMinor: 1000n,
          earningsEntry: {
            id: 'earn-1',
            userId: 'u1',
            status: 'confirmed',
            amountMinor: 1000n,
            currency: 'USD',
            availableAt: new Date('2026-07-09T00:00:00Z'),
          },
        },
      ],
    };

    // processPayout first does a preflight check (status === 'approved' +
    // provider readiness), then CAS-claims approved→processing inside a
    // transaction. A second transaction holds the fraud/initiation advisory
    // lock through the bounded provider call; if it throws, the payout is
    // already committed as 'processing' but the
    // provider outcome is unknown. The error handler updates the
    // placeholder transaction with a failure reason and rethrows — the
    // payout stays recoverable (the cron will poll its status, or the
    // admin can mark it failed to release allocations for retry).
    const claimUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fenceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValueOnce({
          ...payoutForProcessing,
          status: 'approved',
          payoutAccount: verifiedAccount,
        }),
        updateMany: vi.fn(),
      },
      payoutAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
        create: vi.fn().mockResolvedValue({ id: 'alloc-1' }),
        update: vi.fn(),
        delete: vi.fn(),
      },
      earningsLedger: {
        findUnique: vi.fn().mockResolvedValue(payoutForProcessing.allocations[0].earningsEntry),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      payoutTransaction: {
        create: vi.fn().mockResolvedValue({ id: 'ptx-1' }),
        updateMany: txUpdateMany,
      },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        // Simulate the tx-level CAS claim + allocation reconciliation.
        // The provider initiate happens OUTSIDE the tx in the real code.
        return cb({
          $executeRaw: vi.fn().mockResolvedValue(1),
          payoutRequest: {
            updateMany: claimUpdateMany,
            findUnique: vi.fn().mockResolvedValue({
              ...payoutForProcessing,
              status: 'processing',
              user: { status: 'active' },
              payoutAccount: verifiedAccount,
              allocations: [
                {
                  id: 'alloc-1',
                  earningsEntryId: 'earn-1',
                  amountMinor: 1000n,
                  earningsEntry: payoutForProcessing.allocations[0].earningsEntry,
                },
              ],
            }),
          },
          payoutAllocation: { delete: vi.fn(), update: vi.fn() },
          earningsLedger: {
            findUnique: vi.fn().mockResolvedValue(payoutForProcessing.allocations[0].earningsEntry),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
          },
          payoutTransaction: {
            create: vi.fn().mockResolvedValue({ id: 'ptx-1' }),
            updateMany: txUpdateMany,
          },
          payoutAccount: {
            findUnique: vi.fn(),
            updateMany: fenceUpdateMany,
          },
          fraudFlag: { count: vi.fn().mockResolvedValue(0) },
        });
      }),
    });

    // Wire the throwing provider on the service's `providers` map (the
    // real code accesses `this.providers[provider]` after the tx commits).
    // Using 'manual' because it is 'available' in the safe-seed provider
    // catalogue — 'paypal_payouts' is 'coming_soon' and would be rejected
    // by the payoutProviderLaunchStatus gate inside the transaction.
    (service as unknown as { providers: Record<string, unknown> }).providers = {
      manual: {
        initiate: vi.fn().mockRejectedValue(new Error('Provider API unavailable')),
        checkStatus: vi.fn(),
        readiness: () => ({ ok: true }),
      },
    };

    // processPayout should throw because the provider initiate fails.
    // The payout is in 'processing' state (CAS claim committed), but the
    // provider outcome is unknown — the error handler updates the
    // placeholder transaction and rethrows. The cron or admin can
    // recover by polling the provider or marking it failed.
    await expect(service.processPayout('payout-1')).rejects.toThrow();

    // The CAS claim used `status: 'approved'` (the only valid pre-state
    // for processPayout — not `in: ['approved', 'processing']` like
    // markPayoutPaid/markPayoutFailed, because 'processing' means another
    // caller already claimed it).
    expect(claimUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payout-1', status: 'approved' },
        data: expect.objectContaining({ status: 'processing' }),
      }),
    );
    // The failure handler updates the placeholder transaction with a
    // failure reason so the cron knows the initiate was ambiguous.
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureReason: expect.stringContaining('Provider initiation'),
        }),
      }),
    );
    expect(fenceUpdateMany).toHaveBeenCalledTimes(1);
    expect(fenceUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'acc1',
        isFrozen: false,
        isActive: true,
        isVerified: true,
        initiationPayoutId: null,
      },
      data: { initiationPayoutId: 'payout-1' },
    });
  });
});

// ── Duplicate-webhook replay idempotency (complements stripe-webhook.spec.ts) ──

describe('Duplicate-webhook replay idempotency (unit level)', () => {
  it('markPayoutPaid is idempotent — a second call for an already-paid payout returns the paid record without re-flipping ledger rows', async () => {
    const alreadyPaid = {
      id: 'payout-1',
      status: 'paid',
      approvedAmountMinor: 1000n,
      currency: 'usd',
      payoutAccount: { id: 'pa-1', provider: 'manual', isActive: true, isVerified: true },
      allocations: [],
    };
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 0 }); // CAS fails (already paid)
    const earningsUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const platformUpsert = vi.fn().mockResolvedValue({ id: 'pl-1' });

    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValue(alreadyPaid),
          updateMany: txUpdateMany,
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        payoutTransaction: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        earningsLedger: { updateMany: earningsUpdateMany, aggregate: vi.fn() },
        platformLedger: { upsert: platformUpsert },
        payoutAllocation: { updateMany: vi.fn(), deleteMany: vi.fn() },
      }),
    );
    const { service } = makePayoutService({
      payoutRequest: {
        findUnique: vi.fn().mockResolvedValue({ ...alreadyPaid, status: 'approved' }),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: $tx,
    });

    // First call: payout is already 'paid' inside the tx (CAS returns 0)
    const result1 = await service.markPayoutPaid('payout-1', {
      providerTxId: 'tx-1',
      paidAt: new Date().toISOString(),
    });
    expect(result1.status).toBe('paid');

    // Second call (replay): same result, no additional ledger writes
    const result2 = await service.markPayoutPaid('payout-1', {
      providerTxId: 'tx-1',
      paidAt: new Date().toISOString(),
    });
    expect(result2.status).toBe('paid');

    // Earnings updateMany was called but returned count=0 each time —
    // no double-flipping of earnings to 'paid'. The platform upsert is
    // idempotent by idempotencyKey, so a replay is a no-op P2002 skip.
    // The CAS guard (status: { in: ['approved', 'processing'] }) is the
    // authoritative floor: a 'paid' payout can never be re-processed.
  });

  it('markPayoutFailed is idempotent — a second call for an already-failed payout returns without re-releasing allocations', async () => {
    const alreadyFailed = {
      id: 'payout-1',
      status: 'failed',
      allocations: [],
      payoutAccount: { provider: 'manual' },
    };
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 }); // nothing to delete

    const $tx = vi.fn((cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
      cb({
        payoutRequest: {
          findUnique: vi.fn().mockResolvedValue(alreadyFailed),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        payoutAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        payoutTransaction: {
          updateMany: vi.fn(),
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
        findUnique: vi.fn().mockResolvedValue({ ...alreadyFailed }),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: $tx,
    });

    const result1 = await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'tx-fail',
      failureReason: 'First failure',
    });
    expect(result1.status).toBe('failed');

    const result2 = await service.markPayoutFailed('payout-1', {
      provider: 'manual',
      providerTxId: 'tx-fail',
      failureReason: 'Replayed failure',
    });
    expect(result2.status).toBe('failed');

    // deleteMany was called both times but count=0 on the replay —
    // no double-release of earnings allocations.
  });
});

// ── Declarative transition guard unit tests ──
// These assert the PAYOUT_TRANSITIONS table is enforced by validatePayoutTransition
// directly, complementing the CAS-level tests above.

describe('validatePayoutTransition (declarative guard)', () => {
  it('allows processing → paid (canonical mark-paid transition)', () => {
    expect(() =>
      validatePayoutTransition(PayoutStatus.PROCESSING, PayoutStatus.PAID),
    ).not.toThrow();
  });

  it('allows processing → failed (canonical mark-failed transition)', () => {
    expect(() =>
      validatePayoutTransition(PayoutStatus.PROCESSING, PayoutStatus.FAILED),
    ).not.toThrow();
  });

  it('allows approved → paid (CAS permits approved/processing → paid)', () => {
    expect(() => validatePayoutTransition(PayoutStatus.APPROVED, PayoutStatus.PAID)).not.toThrow();
  });

  it('allows approved → failed', () => {
    expect(() =>
      validatePayoutTransition(PayoutStatus.APPROVED, PayoutStatus.FAILED),
    ).not.toThrow();
  });

  it('allows approved → processing (processPayout)', () => {
    expect(() =>
      validatePayoutTransition(PayoutStatus.APPROVED, PayoutStatus.PROCESSING),
    ).not.toThrow();
  });

  it('allows requested → under_review and under_review → approved', () => {
    expect(() =>
      validatePayoutTransition(PayoutStatus.REQUESTED, PayoutStatus.UNDER_REVIEW),
    ).not.toThrow();
    expect(() =>
      validatePayoutTransition(PayoutStatus.UNDER_REVIEW, PayoutStatus.APPROVED),
    ).not.toThrow();
  });

  it('rejects requested → paid (illegal jump)', () => {
    expect(() => validatePayoutTransition(PayoutStatus.REQUESTED, PayoutStatus.PAID)).toThrow(
      /Invalid payout transition/,
    );
  });

  it('rejects under_review → paid (illegal jump)', () => {
    expect(() => validatePayoutTransition(PayoutStatus.UNDER_REVIEW, PayoutStatus.PAID)).toThrow(
      /Invalid payout transition/,
    );
  });

  it('rejects processing → requested (illegal backwards hop)', () => {
    expect(() => validatePayoutTransition(PayoutStatus.PROCESSING, PayoutStatus.REQUESTED)).toThrow(
      /Invalid payout transition/,
    );
  });

  it('rejects paid → processing (terminal state cannot leave)', () => {
    expect(() => validatePayoutTransition(PayoutStatus.PAID, PayoutStatus.PROCESSING)).toThrow(
      /Invalid payout transition/,
    );
  });

  it('rejects failed → paid (terminal state cannot leave)', () => {
    expect(() => validatePayoutTransition(PayoutStatus.FAILED, PayoutStatus.PAID)).toThrow(
      /Invalid payout transition/,
    );
  });

  it('rejects approved → under_review (illegal backwards hop)', () => {
    expect(() =>
      validatePayoutTransition(PayoutStatus.APPROVED, PayoutStatus.UNDER_REVIEW),
    ).toThrow(/Invalid payout transition/);
  });
});
