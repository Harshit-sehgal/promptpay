import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PayoutService } from './payout.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

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
    count: vi.fn(),
  },
  payoutAllocation: {
    findMany: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
  },
  payoutTransaction: {
    create: vi.fn(),
  },
  earningsLedger: {
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
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
const mockPayPalPayouts = {
  initiate: vi.fn().mockResolvedValue({ providerTxId: 'pp_tx_123', status: 'processing' }),
  checkStatus: vi.fn().mockResolvedValue({ status: 'processing' }),
} as any;

describe('PayoutService', () => {
  let service: PayoutService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PayoutService(prismaRef, mockLedger, mockPayPalPayouts);
  });

  describe('addPayoutMethod', () => {
    it('should deactivate existing payout methods of the same provider and create a new one', async () => {
      mockPrisma.payoutAccount.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payoutAccount.create.mockResolvedValue({ id: 'acc_123', provider: 'wise' });

      const res = await service.addPayoutMethod('user_123', {
        provider: 'wise',
        destination: 'test@wise.com',
      });

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
  });

  describe('requestPayout', () => {
    it('should throw ForbiddenException if user is restricted or banned', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'banned' });

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 2000,
          currency: 'USD',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if request amount is below minimum threshold', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active' });

      await expect(
        service.requestPayout('user_123', {
          payoutAccountId: 'acc_123',
          amountMinor: 500, // $5.00
          currency: 'USD',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user has insufficient available earnings', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active' });
      mockPrisma.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 5000 } });
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
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active' });
      mockPrisma.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 5000 } });
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
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', status: 'active' });
      mockPrisma.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 5000 } });
      mockPrisma.payoutAllocation.aggregate.mockResolvedValue({ _sum: { amountMinor: 1000 } }); // available 4000
      mockPrisma.fraudFlag.count.mockResolvedValue(0);
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({ id: 'acc_123', userId: 'user_123' });
      
      mockPrisma.payoutRequest.create.mockResolvedValue({ id: 'req_123', requestedAmountMinor: 2000 });
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([]); // no other allocations
      mockPrisma.earningsLedger.findMany.mockResolvedValue([
        { id: 'earn_1', amountMinor: 1500, status: 'confirmed' },
        { id: 'earn_2', amountMinor: 1000, status: 'confirmed' },
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
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_123',
        status: 'approved',
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
      expect(mockPrisma.payoutRequest.update).toHaveBeenCalledWith({
        where: { id: 'req_123' },
        data: { status: 'processing', processedAt: expect.any(Date) },
      });
    });

    it('should process stub/mock providers without throwing an exception', async () => {
      const providers = ['stripe_connect', 'payoneer', 'wise', 'razorpay', 'manual', 'paypal_email'];
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
      expect(mockPrisma.payoutRequest.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if any allocated earnings entry is already marked as paid (double payout prevention)', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        id: 'req_123',
        status: 'processing',
        allocations: [
          { earningsEntry: { status: 'paid' }, earningsEntryId: 'earn_1' },
        ],
      });

      await expect(
        service.markPayoutPaid('req_123', { providerTxId: 'tx_123', paidAt: new Date().toISOString() })
      ).rejects.toThrow(BadRequestException);
    });

    it('should atomically update status of request, transaction, and earnings ledger to paid', async () => {
      const nowStr = new Date().toISOString();
      mockPrisma.payoutRequest.findUnique.mockImplementation((args: any) => {
        // Return allocations with confirmed status first, then paid status on retrieval at the end
        if (mockPrisma.payoutRequest.update.mock.calls.length > 0) {
          return Promise.resolve({ id: 'req_123', status: 'paid', allocations: [] });
        }
        return Promise.resolve({
          id: 'req_123',
          status: 'processing',
          payoutAccount: { provider: 'wise' },
          allocations: [
            { earningsEntry: { status: 'confirmed' }, earningsEntryId: 'earn_1' },
          ],
        });
      });

      const res = await service.markPayoutPaid('req_123', { providerTxId: 'tx_wise_abc', paidAt: nowStr });

      expect(mockPrisma.payoutRequest.update).toHaveBeenCalledWith({
        where: { id: 'req_123' },
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
  });
});
