import { beforeEach,describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { PayoutService } from './payout.service';
import { PayoutProviderUnsafeFailure } from './payout-provider.errors';

const mockPrisma = {
  payoutAccount: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  payoutRequest: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn(),
  },
  payoutAllocation: {
    findMany: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
  payoutTransaction: {
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  earningsLedger: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  user: {
    findUnique: vi.fn(),
  },
  fraudFlag: {
    count: vi.fn(),
  },
  $transaction: vi.fn(async (arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    if (Array.isArray(arg)) {
      return Promise.all(arg.map(async (fn: any) => (typeof fn === 'function' ? fn() : fn)));
    }
    return arg;
  }),
};

const prismaRef = mockPrisma as any;
const mockLedger = {
  matureEarnings: vi.fn(),
} as any;
const mockReferral = {
  processReferralRewards: vi.fn().mockResolvedValue(undefined),
} as any;
const mockPayPalPayouts = {
  readiness: vi.fn().mockReturnValue({ ok: true }),
  initiate: vi.fn().mockResolvedValue({ providerTxId: 'pp_tx_123', status: 'processing' }),
  checkStatus: vi.fn().mockResolvedValue({ status: 'processing' }),
} as any;
const mockAudit = {
  log: vi.fn().mockResolvedValue(undefined),
} as any;
const mockConfig = {
  get: vi.fn((key: string, fallback?: string) => {
    if (key === 'PAYOUT_REQUIRE_2FA') return 'false';
    return fallback ?? undefined;
  }),
} as any;
const mockStripeConnect = {
  readiness: vi.fn().mockReturnValue({ ok: true }),
  initiate: vi.fn().mockResolvedValue({ providerTxId: 'sc_tx_123', status: 'processing' }),
  checkStatus: vi.fn().mockResolvedValue({ status: 'processing' }),
} as any;
const mockWise = {
  readiness: vi.fn().mockReturnValue({ ok: true }),
  initiate: vi.fn().mockResolvedValue({ providerTxId: 'wise_tx_123', status: 'processing' }),
  checkStatus: vi.fn().mockResolvedValue({ status: 'processing' }),
} as any;

describe('PayoutService', () => {
  let service: PayoutService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PayoutService(prismaRef, mockLedger, mockReferral, mockAudit, mockConfig, mockPayPalPayouts, mockStripeConnect, mockWise);
  });

  describe('addPayoutMethod', () => {
    it('should deactivate existing payout methods of the same provider and create a new one', async () => {
      mockPrisma.payoutAccount.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payoutAccount.create.mockResolvedValue({ id: 'acc_123', provider: 'wise' });

      const res = await service.addPayoutMethod('user_123', {
        provider: 'wise',
        destination: ' Test@Wise.com ',
        currency: 'usd',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(mockPrisma.payoutAccount.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user_123', provider: 'wise', isActive: true },
        data: { isActive: false },
      });
      expect(mockPrisma.payoutAccount.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_123',
          provider: 'wise',
          destination: 'test@wise.com',
          currency: 'USD',
        },
      });
      expect(res.provider).toBe('wise');
    });

    it('rejects invalid email payout destinations before storing the method', async () => {
      await expect(
        service.addPayoutMethod('user_123', {
          provider: 'paypal_payouts',
          destination: 'not-an-email',
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payoutAccount.create).not.toHaveBeenCalled();
    });

    it('rejects malformed Stripe Connect destinations before storing the method', async () => {
      await expect(
        service.addPayoutMethod('user_123', {
          provider: 'stripe_connect',
          destination: 'dev@example.com',
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payoutAccount.create).not.toHaveBeenCalled();
    });

    it('rejects malformed payout currency codes before storing the method', async () => {
      await expect(
        service.addPayoutMethod('user_123', {
          provider: 'wise',
          destination: 'dev@example.com',
          currency: 'US1',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payoutAccount.create).not.toHaveBeenCalled();
    });
  });

  describe('requestPayout', () => {
    it('should throw ForbiddenException if user is restricted or banned', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'banned', emailVerified: false });

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 2000,
          currency: 'USD',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if request amount is below minimum threshold', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active', emailVerified: true });

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 500, // $5.00
          currency: 'USD',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if request amount is zero', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active', emailVerified: true });

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 0,
          currency: 'USD',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if request amount is negative', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active', emailVerified: true });

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: -100,
          currency: 'USD',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('requires MFA before payout when PAYOUT_REQUIRE_2FA is enabled', async () => {
      mockConfig.get.mockImplementationOnce((key: string) =>
        key === 'PAYOUT_REQUIRE_2FA' ? 'true' : undefined,
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_123',
        status: 'active',
        emailVerified: true,
        twoFactorEnabled: false,
      });

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 2000,
          currency: 'USD',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if user has insufficient available earnings', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active', emailVerified: true });
      mockPrisma.earningsLedger.aggregate
        .mockResolvedValueOnce({ _sum: { amountMinor: 5000 } }) // confirmed credits
        .mockResolvedValueOnce({ _sum: { amountMinor: 0 } }); // recovery debits
      mockPrisma.payoutAllocation.aggregate.mockResolvedValue({ _sum: { amountMinor: 4000 } }); // available 1000

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 1500, // wants $15.00 but only $10.00 is available
          currency: 'USD',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if user has open critical/high fraud flags', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active', emailVerified: true });
      mockPrisma.earningsLedger.aggregate
        .mockResolvedValueOnce({ _sum: { amountMinor: 5000 } }) // confirmed credits
        .mockResolvedValueOnce({ _sum: { amountMinor: 0 } }); // recovery debits
      mockPrisma.payoutAllocation.aggregate.mockResolvedValue({ _sum: { amountMinor: 1000 } }); // available 4000
      mockPrisma.fraudFlag.count.mockResolvedValue(1); // open critical flag

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 2000,
          currency: 'USD',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allocate earnings and create a payout request successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active', emailVerified: true });
      mockPrisma.earningsLedger.aggregate
        .mockResolvedValueOnce({ _sum: { amountMinor: 5000 } }) // confirmed credits
        .mockResolvedValueOnce({ _sum: { amountMinor: 0 } }); // recovery debits
      mockPrisma.payoutAllocation.aggregate.mockResolvedValue({ _sum: { amountMinor: 1000 } }); // available 4000
      mockPrisma.fraudFlag.count.mockResolvedValue(0);
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({ id: 'acc_123', userId: 'user_123', currency: 'USD' });
      
      mockPrisma.payoutRequest.create.mockResolvedValue({ id: 'req_123', requestedAmountMinor: 2000 });
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([]); // no other allocations
      mockPrisma.earningsLedger.findMany.mockResolvedValue([
        {
          id: 'earn_1',
          userId: 'user_123',
          campaignId: 'camp_1',
          impressionId: 'imp_1',
          clickId: null,
          entryType: 'credit',
          amountMinor: 1500,
          status: 'confirmed',
          currency: 'USD',
          availableAt: new Date('2026-01-01T00:00:00.000Z'),
          description: 'full entry',
        },
        {
          id: 'earn_2',
          userId: 'user_123',
          campaignId: 'camp_2',
          impressionId: 'imp_2',
          clickId: null,
          entryType: 'credit',
          amountMinor: 1000,
          status: 'confirmed',
          currency: 'USD',
          availableAt: new Date('2026-01-02T00:00:00.000Z'),
          description: 'partial entry',
        },
      ]);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_123',
        status: 'requested',
        allocations: [{ earningsEntryId: 'earn_1', amountMinor: 1500 }, { earningsEntryId: 'earn_2', amountMinor: 500 }],
      });

      const res = await service.requestPayout('user_123', {
        payoutAccountId: 'acc_123',
        amountMinor: 2000,
        currency: 'USD',
      });

      expect(res.status).toBe('requested');
      expect(mockPrisma.payoutAllocation.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.earningsLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user_123',
            status: 'confirmed',
            entryType: 'credit',
            currency: 'USD',
          }),
        }),
      );
      // The partial-allocation path uses updateMany gated on the
      // snapshot amountMinor (a CAS pin — see service code comment) so
      // concurrent splits return count=0 and the call retries against
      // fresh state rather than double-allocating. The mock returns
      // count=1 meaning "row state matched" — exactly what the CAS pin
      // looks for.
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: { id: 'earn_2', amountMinor: 1000 },
        data: expect.objectContaining({ amountMinor: 500 }),
      });
      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user_123',
          campaignId: 'camp_2',
          impressionId: 'imp_2',
          amountMinor: 500,
          status: 'confirmed',
          idempotencyKey: 'payout-remainder-req_123-earn_2',
          description: 'partial entry',
        }),
      });
    });

    it('normalizes payout currency before balance checks and allocation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active', emailVerified: true });
      mockPrisma.earningsLedger.aggregate
        .mockResolvedValueOnce({ _sum: { amountMinor: 5000 } })
        .mockResolvedValueOnce({ _sum: { amountMinor: 0 } });
      mockPrisma.payoutAllocation.aggregate.mockResolvedValue({ _sum: { amountMinor: 0 } });
      mockPrisma.fraudFlag.count.mockResolvedValue(0);
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({ id: 'acc_123', userId: 'user_123', currency: 'USD' });
      mockPrisma.payoutRequest.create.mockResolvedValue({ id: 'req_123', requestedAmountMinor: 2000 });
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([]);
      mockPrisma.earningsLedger.findMany.mockResolvedValue([
        {
          id: 'earn_1',
          userId: 'user_123',
          campaignId: 'camp_1',
          impressionId: 'imp_1',
          clickId: null,
          entryType: 'credit',
          amountMinor: 2000,
          status: 'confirmed',
          currency: 'USD',
          availableAt: new Date('2026-01-01T00:00:00.000Z'),
          description: 'entry',
        },
      ]);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_123',
        status: 'requested',
        currency: 'USD',
        allocations: [{ earningsEntryId: 'earn_1', amountMinor: 2000 }],
      });

      await service.requestPayout('user_123', {
        payoutAccountId: 'acc_123',
        amountMinor: 2000,
        currency: 'usd',
      });

      expect(mockPrisma.earningsLedger.aggregate).toHaveBeenNthCalledWith(1, {
        where: { userId: 'user_123', status: 'confirmed', entryType: 'credit', currency: 'USD' },
        _sum: { amountMinor: true },
      });
      expect(mockPrisma.earningsLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ currency: 'USD' }),
        }),
      );
      expect(mockPrisma.payoutRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'USD' }),
      });
    });
  });

  describe('getPayoutInfo', () => {
    it('does not subtract already-paid allocations from confirmed availability', async () => {
      mockPrisma.payoutAccount.findMany.mockResolvedValue([{ id: 'acc_usd', currency: 'USD' }]);
      mockPrisma.payoutRequest.findMany.mockResolvedValue([]);
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 1000 } }]) // confirmed credits
        .mockResolvedValueOnce([]); // recovery debits
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([]);

      const result = await service.getPayoutInfo('user_123');

      expect(result.availableBalanceMinor).toBe(1000);
      expect(result.availableBalanceByCurrency).toEqual({ USD: 1000 });
      expect(mockPrisma.payoutAllocation.findMany).toHaveBeenCalledWith({
        where: {
          payoutRequest: {
            userId: 'user_123',
            status: { in: ['requested', 'under_review', 'approved', 'processing'] },
          },
        },
        select: {
          amountMinor: true,
          earningsEntry: { select: { currency: true } },
        },
      });
    });

    it('subtracts confirmed recovery debits from payout availability', async () => {
      mockPrisma.payoutAccount.findMany.mockResolvedValue([{ id: 'acc_usd', currency: 'USD' }]);
      mockPrisma.payoutRequest.findMany.mockResolvedValue([]);
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 1000 } }]) // confirmed credits
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 250 } }]); // recovery debits
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([]);

      const result = await service.getPayoutInfo('user_123');

      expect(result.availableBalanceMinor).toBe(750);
      expect(result.availableBalanceByCurrency).toEqual({ USD: 750 });
    });

    it('keeps availability separated by currency', async () => {
      mockPrisma.payoutAccount.findMany.mockResolvedValue([{ id: 'acc_eur', currency: 'EUR' }]);
      mockPrisma.payoutRequest.findMany.mockResolvedValue([]);
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 1000 } },
          { currency: 'EUR', _sum: { amountMinor: 2000 } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 300 } },
          { currency: 'EUR', _sum: { amountMinor: 500 } },
        ]);
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([
        { amountMinor: 250, earningsEntry: { currency: 'EUR' } },
      ]);

      const result = await service.getPayoutInfo('user_123');

      expect(result.currency).toBe('EUR');
      expect(result.availableBalanceMinor).toBe(1250);
      expect(result.availableBalanceByCurrency).toEqual({ USD: 700, EUR: 1250 });
    });
  });

  describe('getAvailableForPayout', () => {
    it('returns a currency breakdown instead of mixing confirmed earnings currencies', async () => {
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([]);
      mockPrisma.earningsLedger.findMany.mockResolvedValue([
        { id: 'usd_1', amountMinor: 1000, currency: 'USD' },
        { id: 'eur_1', amountMinor: 2000, currency: 'EUR' },
      ]);
      mockPrisma.earningsLedger.groupBy.mockResolvedValue([
        { currency: 'USD', _sum: { amountMinor: 300 } },
        { currency: 'EUR', _sum: { amountMinor: 500 } },
      ]);

      const result = await service.getAvailableForPayout('user_123');

      expect(result.totalMinor).toBe(700);
      expect(result.currency).toBe('USD');
      expect(result.totalsByCurrency).toEqual({ USD: 700, EUR: 1500 });
    });
  });

  describe('processPayout', () => {
    it('should throw BadRequestException if payout status is not approved', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_123',
        status: 'requested',
        allocations: [{ amountMinor: 2000 }],
      });

      await expect(service.processPayout('req_123')).rejects.toThrow(BadRequestException);
    });

    it('should route to the correct provider and initiate transaction', async () => {
      // New processPayout path atomically claims approved → processing
      // BEFORE calling the provider, to prevent concurrent
      // `processPayout` calls from firing provider.initiate() twice
      // (real-money double-pay). The transaction-wrapped re-read sees
      // the same approved-state row (claim flipped it to processing).
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_123',
        status: 'processing', // already claimed by the updateMany above
        currency: 'USD',
        approvedAmountMinor: 2000,
        allocations: [{ amountMinor: 2000 }],
        payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
      });

      const result = await service.processPayout('req_123');

      expect(mockPayPalPayouts.initiate).toHaveBeenCalledWith({
        payoutRequestId: 'req_123',
        destination: 'dev@paypal.com',
        amountMinor: 2000,
        currency: 'USD',
      });
      expect(result.status).toBe('processing');
      expect(mockPrisma.payoutTransaction.create).toHaveBeenCalled();
      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req_123', status: 'approved' },
        data: { status: 'processing', processedAt: expect.any(Date) },
      });
    });

    it('should process stub/mock providers without throwing an exception', async () => {
      const providers = ['payoneer', 'razorpay', 'manual', 'paypal_email'];
      for (const provider of providers) {
        mockPrisma.payoutRequest.findUnique.mockResolvedValue({
          id: `req_${provider}`,
          status: 'approved',
          currency: 'USD',
          approvedAmountMinor: 2000,
          allocations: [{ amountMinor: 2000 }],
          payoutAccount: { provider, destination: 'dev@test.com' },
        });

        const result = await service.processPayout(`req_${provider}`);
        expect(result.status).toBe('processing');
        expect(result.providerTxId).toBeDefined();
      }
    });

    it('blocks unimplemented automated stub providers in production before claiming the payout', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        mockPrisma.payoutRequest.findUnique.mockResolvedValue({
          id: 'req_payoneer',
          status: 'approved',
          currency: 'USD',
          approvedAmountMinor: 2000,
          allocations: [{ amountMinor: 2000 }],
          payoutAccount: { provider: 'payoneer', destination: 'dev@test.com' },
        });

        await expect(service.processPayout('req_payoneer')).rejects.toThrow(BadRequestException);

        expect(mockPrisma.payoutRequest.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.payoutTransaction.create).not.toHaveBeenCalled();
      } finally {
        if (originalNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = originalNodeEnv;
        }
      }
    });

    it('blocks unconfigured PayPal Payouts in production before claiming the payout', async () => {
      mockPayPalPayouts.readiness.mockReturnValueOnce({
        ok: false,
        reason: 'PayPal Payouts is not configured',
      });
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_paypal',
        status: 'approved',
        currency: 'USD',
        approvedAmountMinor: 2000,
        allocations: [{ amountMinor: 2000 }],
        payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
      });

      await expect(service.processPayout('req_paypal')).rejects.toThrow(BadRequestException);

      expect(mockPrisma.payoutRequest.updateMany).not.toHaveBeenCalled();
      expect(mockPayPalPayouts.initiate).not.toHaveBeenCalled();
      expect(mockPrisma.payoutTransaction.create).not.toHaveBeenCalled();
    });

    it('marks provider-declared initiate failures as failed and releases allocations', async () => {
      mockPayPalPayouts.initiate.mockResolvedValueOnce({
        providerTxId: 'pp_failed_123',
        status: 'failed',
      });
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payoutRequest.findUnique
        .mockResolvedValueOnce({
          id: 'req_failed',
          status: 'approved',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
        })
        .mockResolvedValueOnce({
          id: 'req_failed',
          status: 'processing',
          currency: 'USD',
          approvedAmountMinor: 2000,
          allocations: [{ amountMinor: 2000, earningsEntryId: 'earn_1' }],
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
        })
        .mockResolvedValueOnce({
          id: 'req_failed',
          status: 'failed',
          allocations: [],
        });

      const result = await service.processPayout('req_failed');

      expect(result.status).toBe('failed');
      expect(mockPrisma.payoutTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          payoutRequestId: 'req_failed',
          provider: 'paypal_payouts',
          providerTxId: 'pp_failed_123',
          status: { in: ['approved', 'processing'] },
        },
        data: {
          status: 'failed',
          failureReason: 'Provider initiate returned failed',
        },
      });
      expect(mockPrisma.payoutTransaction.create).toHaveBeenCalledWith({
        data: {
          payoutRequestId: 'req_failed',
          provider: 'paypal_payouts',
          providerTxId: 'pp_failed_123',
          status: 'failed',
          failureReason: 'Provider initiate returned failed',
        },
      });
      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'req_failed', status: { in: ['approved', 'processing'] } },
        data: { status: 'failed' },
      });
      expect(mockPrisma.payoutAllocation.deleteMany).toHaveBeenCalledWith({
        where: { payoutRequestId: 'req_failed' },
      });
    });

    it('marks safe provider-thrown initiate failures as failed and releases allocations', async () => {
      mockPayPalPayouts.initiate.mockRejectedValueOnce(new Error('provider unavailable'));
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payoutRequest.findUnique
        .mockResolvedValueOnce({
          id: 'req_throw',
          status: 'approved',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
        })
        .mockResolvedValueOnce({
          id: 'req_throw',
          status: 'processing',
          currency: 'USD',
          approvedAmountMinor: 2000,
          allocations: [{ amountMinor: 2000, earningsEntryId: 'earn_1' }],
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
        })
        .mockResolvedValueOnce({
          id: 'req_throw',
          status: 'failed',
          allocations: [],
        });

      await expect(service.processPayout('req_throw')).rejects.toThrow(/provider unavailable/);

      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'req_throw', status: { in: ['approved', 'processing'] } },
        data: { status: 'failed' },
      });
      expect(mockPrisma.payoutAllocation.deleteMany).toHaveBeenCalledWith({
        where: { payoutRequestId: 'req_throw' },
      });
      expect(mockPrisma.payoutTransaction.create).toHaveBeenCalledWith({
        data: {
          payoutRequestId: 'req_throw',
          provider: 'paypal_payouts',
          providerTxId: 'initiate_failed_req_throw',
          status: 'failed',
          failureReason: 'Provider initiate threw before a safe provider transaction was recorded: provider unavailable',
        },
      });
    });

    it('does not release allocations when provider reports an unsafe partial money movement', async () => {
      mockStripeConnect.initiate.mockRejectedValueOnce(
        new PayoutProviderUnsafeFailure('manual Stripe reconciliation required'),
      );
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payoutRequest.findUnique
        .mockResolvedValueOnce({
          id: 'req_unsafe',
          status: 'approved',
          payoutAccount: { provider: 'stripe_connect', destination: 'acct_dev' },
        })
        .mockResolvedValueOnce({
          id: 'req_unsafe',
          status: 'processing',
          currency: 'USD',
          approvedAmountMinor: 2000,
          allocations: [{ amountMinor: 2000, earningsEntryId: 'earn_1' }],
          payoutAccount: { provider: 'stripe_connect', destination: 'acct_dev' },
        });

      await expect(service.processPayout('req_unsafe')).rejects.toThrow(/manual Stripe reconciliation required/);

      expect(mockPrisma.payoutAllocation.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.payoutTransaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req_unsafe', status: 'approved' },
        data: { status: 'processing', processedAt: expect.any(Date) },
      });
    });

    it('refuses to call provider when an allocated earnings entry is held by a fraud flag (race vs holdEarnings)', async () => {
      // Round 23 (HIGH #1) closed the race window where a fraud flag
      // could flip allocated earnings from `confirmed → held` between
      // the `approved → processing` claim and the provider call. The
      // guarantee is that the provider never fires unless every
      // allocated entry is still `confirmed`.
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_held',
        status: 'processing',
        currency: 'USD',
        approvedAmountMinor: 5000,
        allocations: [
          { amountMinor: 5000, earningsEntryId: 'earn_1' },
        ],
        payoutAccount: { provider: 'paypal_email', destination: 'dev@test.com' },
      });
      // tx.earningsLedger.count returns 1 → one entry is held (not confirmed).
      mockPrisma.earningsLedger.count.mockResolvedValueOnce(1);

      await expect(service.processPayout('req_held')).rejects.toThrow(BadRequestException);
      expect(mockPayPalPayouts.initiate).not.toHaveBeenCalled();
      expect(mockPrisma.payoutTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('markPayoutPaid', () => {
    it('should throw BadRequestException if payout request does not exist', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.markPayoutPaid('req_123', { providerTxId: 'tx_123', paidAt: new Date().toISOString() })
      ).rejects.toThrow(BadRequestException);
    });

    it('should return already paid payout request directly (idempotency)', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({ id: 'req_123', status: 'paid', allocations: [] });

      const res = await service.markPayoutPaid('req_123', { providerTxId: 'tx_123', paidAt: new Date().toISOString() });
      expect(res.status).toBe('paid');
      expect(mockPrisma.payoutRequest.updateMany).not.toHaveBeenCalled();
    });

    it('should not throw for already-paid earnings entries — updateMany silently skips them', async () => {
      // First call (outer read): pre-paid snapshot. Second call (inside tx after update):
      // paid state.
      let findCalled = false;
      mockPrisma.payoutRequest.findUnique.mockImplementation(() => {
        if (findCalled) {
          return Promise.resolve({ id: 'req_123', status: 'paid', allocations: [] });
        }
        findCalled = true;
        return Promise.resolve({
          id: 'req_123',
          status: 'processing',
          userId: 'user_123',
          payoutAccount: { provider: 'wise' },
          allocations: [
            { earningsEntry: { status: 'paid' }, earningsEntryId: 'earn_1' },
          ],
        });
      });

      const nowStr = new Date().toISOString();
      const res = await service.markPayoutPaid('req_123', { providerTxId: 'tx_123', paidAt: nowStr });

      expect(res.status).toBe('paid');
      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req_123', status: { in: ['approved', 'processing'] } },
        data: { status: 'paid', paidAt: new Date(nowStr) },
      });
    });

    it('updates an existing processing provider transaction when marking paid', async () => {
      const nowStr = new Date().toISOString();
      mockPrisma.payoutTransaction.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.payoutRequest.findUnique.mockImplementation((_args: any) => {
        if (mockPrisma.payoutRequest.updateMany.mock.calls.length > 0) {
          return Promise.resolve({ id: 'req_123', status: 'paid', userId: 'user_123', allocations: [] });
        }
        return Promise.resolve({
          id: 'req_123',
          status: 'processing',
          userId: 'user_123',
          payoutAccount: { provider: 'paypal_payouts' },
          allocations: [
            { earningsEntry: { status: 'confirmed' }, earningsEntryId: 'earn_1' },
          ],
        });
      });
      mockPrisma.earningsLedger.aggregate.mockResolvedValue({ _count: { _all: 1 } });

      const res = await service.markPayoutPaid('req_123', { providerTxId: 'pp_tx_123', paidAt: nowStr });

      expect(mockPrisma.payoutTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          payoutRequestId: 'req_123',
          provider: 'paypal_payouts',
          providerTxId: 'pp_tx_123',
          status: { in: ['approved', 'processing'] },
        },
        data: {
          status: 'paid',
          paidAt: new Date(nowStr),
          failureReason: null,
        },
      });
      expect(mockPrisma.payoutTransaction.create).not.toHaveBeenCalled();
      expect(res.status).toBe('paid');
    });

    it('should reject marking a payout paid from a non-payable state (e.g. rejected)', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_123',
        status: 'rejected',
        userId: 'user_123',
        payoutAccount: { provider: 'wise' },
        allocations: [],
      });

      await expect(
        service.markPayoutPaid('req_123', { providerTxId: 'tx_123', paidAt: new Date().toISOString() })
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.payoutRequest.updateMany).not.toHaveBeenCalled();
    });

    it('should atomically update status of request, transaction, and earnings ledger to paid', async () => {
      const nowStr = new Date().toISOString();
      mockPrisma.payoutRequest.findUnique.mockImplementation((_args: any) => {
        // Return allocations with confirmed status first, then paid status on retrieval at the end
        if (vi.isMockFunction(mockPrisma.payoutRequest.updateMany) &&
            mockPrisma.payoutRequest.updateMany.mock.calls.length > 0) {
          return Promise.resolve({ id: 'req_123', status: 'paid', userId: 'user_123', allocations: [] });
        }
        return Promise.resolve({
          id: 'req_123',
          status: 'processing',
          userId: 'user_123',
          payoutAccount: { provider: 'wise' },
          allocations: [
            { earningsEntry: { status: 'confirmed' }, earningsEntryId: 'earn_1' },
          ],
        });
      });
      // Post-CAS authoritative re-count: every allocated id now in 'paid'.
      mockPrisma.earningsLedger.aggregate.mockResolvedValue({ _count: { _all: 1 } });

      const res = await service.markPayoutPaid('req_123', { providerTxId: 'tx_wise_abc', paidAt: nowStr });

      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req_123', status: { in: ['approved', 'processing'] } },
        data: { status: 'paid', paidAt: new Date(nowStr) },
      });
      expect(mockPrisma.payoutTransaction.create).toHaveBeenCalledWith({
        data: {
          payoutRequestId: 'req_123',
          provider: 'wise',
          providerTxId: 'tx_wise_abc',
          status: 'paid',
          paidAt: new Date(nowStr),
        },
      });
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['earn_1'] }, status: 'confirmed' },
        data: { status: 'paid' },
      });
      expect(res.status).toBe('paid');
    });

    it('refuses to mark paid when a fraud hold intervened (allocated entry no longer confirmed)', async () => {
      // A concurrent critical fraud flag ran `holdEarnings(userId)` between
      // the snapshot read and the authoritative per-row CAS — flipping the
      // allocated entry `confirmed` → `held`. The conditional `updateMany
      // where status: 'confirmed'` silently SKIPS the held row, so the
      // post-check aggregate sees fewer 'paid' rows than allocated. This MUST
      // throw and roll back the `payoutRequest → paid` flip + the
      // `payoutTransaction` row; otherwise the payout succeeds (money leaves)
      // while the developer's earnings entry is orphaned in `held` — and when
      // the false-positive flag releases it, the developer can withdraw again
      // (double-spend).
      const nowStr = new Date().toISOString();
      mockPrisma.payoutRequest.findUnique.mockImplementation((_args: any) => {
        return Promise.resolve({
          id: 'req_123',
          status: 'processing',
          userId: 'user_123',
          payoutAccount: { provider: 'wise' },
          allocations: [
            { earningsEntry: { status: 'confirmed' }, earningsEntryId: 'earn_1' },
            { earningsEntry: { status: 'confirmed' }, earningsEntryId: 'earn_2' },
          ],
        });
      });
      // Post-CAS re-count: only earn_1 transitioned to 'paid' (earn_2 was
      // held by the concurrent fraud flag and skipped by the CAS).
      mockPrisma.earningsLedger.aggregate.mockResolvedValue({ _count: { _all: 1 } });

      await expect(
        service.markPayoutPaid('req_123', { providerTxId: 'tx_wise_abc', paidAt: nowStr }),
      ).rejects.toThrow(BadRequestException);

      // The throw rolls back the whole $transaction: payoutRequest never
      // transitioned to 'paid' (its CAS was inside the same tx), and the
      // payoutTransaction row was rolled back too.
      expect(mockPrisma.payoutTransaction.create).toHaveBeenCalled();
      // The earnings ledger CAS still ran with the 'confirmed' filter.
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['earn_1', 'earn_2'] }, status: 'confirmed' },
        data: { status: 'paid' },
      });
    });
  });

  describe('markPayoutFailed', () => {
    it('updates an existing processing provider transaction and releases allocations', async () => {
      mockPrisma.payoutRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.payoutTransaction.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_failed',
        status: 'failed',
        allocations: [],
      });

      const res = await service.markPayoutFailed('req_failed', {
        provider: 'paypal_payouts',
        providerTxId: 'pp_tx_123',
        failureReason: 'Provider reported failure',
      });

      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req_failed', status: { in: ['approved', 'processing'] } },
        data: { status: 'failed' },
      });
      expect(mockPrisma.payoutTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          payoutRequestId: 'req_failed',
          provider: 'paypal_payouts',
          providerTxId: 'pp_tx_123',
          status: { in: ['approved', 'processing'] },
        },
        data: {
          status: 'failed',
          failureReason: 'Provider reported failure',
        },
      });
      expect(mockPrisma.payoutTransaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.payoutAllocation.deleteMany).toHaveBeenCalledWith({
        where: { payoutRequestId: 'req_failed' },
      });
      expect(res.status).toBe('failed');
    });

    it('rejects marking failed from a non-failable state', async () => {
      mockPrisma.payoutRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.payoutRequest.findUnique.mockResolvedValueOnce({
        id: 'req_paid',
        status: 'paid',
        allocations: [],
      });

      await expect(
        service.markPayoutFailed('req_paid', {
          provider: 'paypal_payouts',
          providerTxId: 'pp_tx_123',
          failureReason: 'Provider reported failure',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.payoutTransaction.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payoutAllocation.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects an invalid provider before mutating payout state', async () => {
      await expect(
        service.markPayoutFailed('req_failed', {
          provider: 'not_a_provider',
          providerTxId: 'tx_123',
          failureReason: 'Provider reported failure',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payoutRequest.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payoutTransaction.updateMany).not.toHaveBeenCalled();
    });
  });
});
