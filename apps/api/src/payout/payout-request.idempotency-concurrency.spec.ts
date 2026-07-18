import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

import { makePayoutService } from './test/payout-test-helper';

/**
 * Focused tests for PayoutService.requestPayout idempotency.
 *
 * The production code deliberately lets a P2002 unique-constraint error on
 * (userId, idempotencyKey) roll back the interactive transaction, then
 * re-reads the winning payout with the normal Prisma client and verifies the
 * replayed payload matches. These tests exercise that path with a mocked
 * Prisma client.
 */

function makeIdempotentService(overrides: Record<string, unknown> = {}) {
  return makePayoutService({
    payoutAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc1',
        userId: 'u1',
        isActive: true,
        isVerified: true,
        currency: 'USD',
        createdAt: new Date(),
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
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

describe('PayoutService.requestPayout idempotency replay', () => {
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

    const { prisma, service } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null) // outside-tx pre-check
          .mockResolvedValueOnce(null) // in-tx pre-check
          .mockResolvedValueOnce(winner), // P2002 catch re-read
        create: vi.fn().mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            clientVersion: '0.0.0',
            code: 'P2002',
            meta: { target: ['user_id', 'idempotency_key'] },
          }),
        ),
      },
      earningsLedger: {
        aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
          if (args?.where?.entryType === 'debit') {
            return Promise.resolve({ _sum: { amountMinor: 0n } });
          }
          return Promise.resolve({ _sum: { amountMinor: 30_00n } });
        }),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'earn-1',
              amountMinor: 3000n,
              currency: 'USD',
              entryType: 'credit',
              status: 'confirmed',
            },
          ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'earn-new' }),
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

  it('rejects a concurrent replay with a mismatched amount (409, no duplicate created)', async () => {
    const winner = {
      id: 'pr-winner',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'mismatch-key',
      allocations: [],
    };

    const { prisma, service } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner),
        create: vi.fn().mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            clientVersion: '0.0.0',
            code: 'P2002',
            meta: { target: ['user_id', 'idempotency_key'] },
          }),
        ),
      },
      earningsLedger: {
        aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
          if (args?.where?.entryType === 'debit') {
            return Promise.resolve({ _sum: { amountMinor: 0n } });
          }
          return Promise.resolve({ _sum: { amountMinor: 30_00n } });
        }),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'earn-1',
              amountMinor: 3000n,
              currency: 'USD',
              entryType: 'credit',
              status: 'confirmed',
            },
          ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'earn-new' }),
      },
    });

    await expect(
      service.requestPayout('u1', {
        payoutAccountId: 'acc1',
        amountMinor: 2000n, // different amount
        currency: 'USD',
        idempotencyKey: 'mismatch-key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.payoutRequest.create).toHaveBeenCalledTimes(1);
  });

  it('does not emit a request_payout audit event for the rolled-back loser, but the winner did emit one', async () => {
    const winner = {
      id: 'pr-winner',
      userId: 'u1',
      payoutAccountId: 'acc1',
      status: 'requested',
      requestedAmountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'audit-race-key',
      allocations: [],
    };

    const { service, audit } = makeIdempotentService({
      payoutRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner),
        create: vi.fn().mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            clientVersion: '0.0.0',
            code: 'P2002',
            meta: { target: ['user_id', 'idempotency_key'] },
          }),
        ),
      },
      earningsLedger: {
        aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
          if (args?.where?.entryType === 'debit') {
            return Promise.resolve({ _sum: { amountMinor: 0n } });
          }
          return Promise.resolve({ _sum: { amountMinor: 30_00n } });
        }),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'earn-1',
              amountMinor: 3000n,
              currency: 'USD',
              entryType: 'credit',
              status: 'confirmed',
            },
          ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'earn-new' }),
      },
    });

    await service.requestPayout('u1', {
      payoutAccountId: 'acc1',
      amountMinor: 1000n,
      currency: 'USD',
      idempotencyKey: 'audit-race-key',
    });

    // The loser of the race replays the winner and returns it. No success
    // audit should be emitted for the rolled-back attempt.
    expect(audit.logStrict).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
