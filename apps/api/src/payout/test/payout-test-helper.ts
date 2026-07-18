import { vi } from 'vitest';

import { AuditService } from '../../audit/audit.service';
import { LedgerService } from '../../ledger/ledger.service';
import { ReferralService } from '../../referral/referral.service';
import { PayoutService } from '../payout.service';

/**
 * Factory for constructing a PayoutService wired to a mocked Prisma client.
 * This helper is intentionally kept in a non-test `.ts` file so Vitest does not
 * execute it as a test suite.
 */
export function makePayoutService(
  prismaOverrides: Record<string, unknown> = {},
  require2fa = false,
) {
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
    payoutAccount: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
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
  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
    logStrict: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const service = new PayoutService(
    prisma as never,
    {} as LedgerService,
    referral as unknown as ReferralService,
    audit,
    config,
    {} as never,
    {} as never,
    {} as never,
    runtimeConfig as never,
    {} as never,
  );
  return { prisma, service, audit };
}
