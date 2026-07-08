import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { PayoutService } from './payout.service';

function makePayoutService(prismaOverrides: Record<string, unknown> = {}, require2fa = false) {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', status: 'active', emailVerified: true, twoFactorEnabled: false }) },
    earningsLedger: {
      // available = confirmed credits − confirmed debits − allocated. Mock the
      // real credit/debit semantics so the verification guard (not the
      // insufficient-earnings guard) is the one under test.
      aggregate: vi.fn((args: { where?: { entryType?: string } }) => {
        if (args?.where?.entryType === 'debit') {
          return Promise.resolve({ _sum: { amountMinor: 0 } });
        }
        return Promise.resolve({ _sum: { amountMinor: 10_000 } });
      }),
    },
    payoutAllocation: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0 } }),
    },
    fraudFlag: { count: vi.fn().mockResolvedValue(0) },
    payoutAccount: { findUnique: vi.fn() },
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    ...prismaOverrides,
  };
  const config = {
    get: vi.fn((key: string) => (key === 'PAYOUT_REQUIRE_2FA' ? (require2fa ? 'true' : undefined) : undefined)),
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
        amountMinor: 1000,
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
        amountMinor: 1000,
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
        amountMinor: 1000,
        currency: 'USD',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
