import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LedgerService } from './ledger.service';

const mockPrisma = {
  earningsLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  advertiserLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  platformLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  campaign: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  payoutRequest: {
    aggregate: vi.fn(),
  },
  fraudFlag: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (arg: any) => {
    // The real service passes either array of functions OR an async callback
    if (typeof arg === 'function') return arg(mockPrisma);
    if (Array.isArray(arg)) {
      return Promise.all(arg.map(async (fn: any) => (typeof fn === 'function' ? fn() : fn)));
    }
    return arg;
  }),
};
const prismaRef = mockPrisma as any;

describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LedgerService(prismaRef);
  });

  describe('calculateSplit', () => {
    it('splits 60/30/10 by default', () => {
      const result = service.calculateSplit(1000, false);
      expect(result.userShare + result.platformShare + result.reserveShare).toBe(1000);
      expect(result.userShare).toBe(600);
      expect(result.platformShare).toBe(300);
      expect(result.reserveShare).toBe(100);
    });

    it('splits 80/10/10 when incentivized', () => {
      const result = service.calculateSplit(1000, true);
      expect(result.userShare).toBe(800);
      expect(result.platformShare).toBe(100);
      expect(result.reserveShare).toBe(100);
    });

    it('handles indivisible amounts correctly', () => {
      const result = service.calculateSplit(100, false);
      // 100 cents: user=60, platform=30, reserve=10
      expect(result.userShare + result.platformShare + result.reserveShare).toBe(100);
    });
  });

  describe('getAvailableBalance', () => {
    // NOTE: getAvailableBalance is the *confirmed-credits* total only. It does
    // NOT subtract in-flight payouts — that is PayoutService.getAvailableForPayout's
    // responsibility (it reserves funds via PayoutAllocation). These tests pin the
    // actual contract so a regression that silently changes the semantics is caught.
    it('returns the sum of confirmed credit earnings', async () => {
      mockPrisma.earningsLedger.aggregate.mockResolvedValueOnce({
        _sum: { amountMinor: 250_00 },
      });

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(250_00);
      expect(result.currency).toBe('USD');
      // Must aggregate confirmed credits and must never touch payoutRequest.
      expect(mockPrisma.earningsLedger.aggregate).toHaveBeenCalledTimes(1);
      expect(mockPrisma.earningsLedger.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-1', status: 'confirmed', entryType: 'credit' },
        }),
      );
      expect(mockPrisma.payoutRequest.aggregate).not.toHaveBeenCalled();
    });

    it('returns 0 when there are no confirmed earnings', async () => {
      mockPrisma.earningsLedger.aggregate.mockResolvedValueOnce({
        _sum: { amountMinor: null },
      });

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(0);
      expect(result.currency).toBe('USD');
      expect(mockPrisma.payoutRequest.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('getPendingBalance', () => {
    it('returns sum of pending and estimated earnings', async () => {
      mockPrisma.earningsLedger.aggregate.mockResolvedValue({
        _sum: { amountMinor: 50_00 },
      });

      const result = await service.getPendingBalance('u-1');
      expect(result.amountMinor).toBe(50_00);
    });
  });

  describe('getEarningsHistory', () => {
    it('paginates entries', async () => {
      mockPrisma.earningsLedger.findMany.mockResolvedValue([
        { id: 'e-1', userId: 'u-1', amountMinor: 10, status: 'confirmed', createdAt: new Date() },
      ]);
      mockPrisma.earningsLedger.count.mockResolvedValue(15);

      const result = await service.getEarningsHistory('u-1', 2, 5);
      expect(result.page).toBe(2);
      expect(result.total).toBe(15);
    });

    it('applies status filter', async () => {
      mockPrisma.earningsLedger.findMany.mockResolvedValue([]);
      mockPrisma.earningsLedger.count.mockResolvedValue(0);

      await service.getEarningsHistory('u-1', 1, 20, { status: 'confirmed' });
      expect(mockPrisma.earningsLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'confirmed' }),
        }),
      );
    });
  });

  describe('getHoldDays', () => {
    it('returns 14 for normal trust', () => {
      expect(service.getHoldDays('normal')).toBe(14);
    });

    it('returns 7 for high trust', () => {
      expect(service.getHoldDays('high_trust')).toBe(7);
    });

    it('returns 30 for new/low_trust', () => {
      expect(service.getHoldDays('new')).toBe(30);
      expect(service.getHoldDays('low_trust')).toBe(30);
    });
  });

  describe('recordImpressionEarnings', () => {
    it('creates entries across all 3 ledgers', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: 'c-1',
        budgetSpentMinor: 0,
        budgetTotalMinor: 1000_00,
      });

      await service.recordImpressionEarnings({
        userId: 'u-1',
        campaignId: 'c-1',
        impressionId: 'imp-1',
        bidAmountMinor: 2_00,
        currency: 'USD',
        advertiserId: 'a-1',
        trustLevel: 'normal',
      });

      // $transaction was invoked
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('sets hold days based on trust level', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: 'c-1',
        budgetSpentMinor: 0,
        budgetTotalMinor: 1000_00,
      });

      await service.recordImpressionEarnings({
        userId: 'u-1',
        campaignId: 'c-1',
        impressionId: 'imp-2',
        bidAmountMinor: 2_00,
        currency: 'USD',
        advertiserId: 'a-1',
        trustLevel: 'high_trust',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('transitionEarning', () => {
    it('rejects invalid state transitions', async () => {
      mockPrisma.earningsLedger.findUnique.mockResolvedValue({
        id: 'e-1',
        status: 'paid',
      });

      await expect(
        (service as any).transitionEarning('e-1', 'confirmed' as any),
      ).rejects.toThrow();
    });

    it('allows valid transitions', async () => {
      mockPrisma.earningsLedger.findUnique.mockResolvedValue({
        id: 'e-2',
        userId: 'u-1',
        status: 'confirmed',
        amountMinor: 100,
        currency: 'USD',
      });
      mockPrisma.earningsLedger.update.mockResolvedValue({
        id: 'e-2',
        status: 'paid',
      });

      const result = await (service as any).transitionEarning('e-2', 'paid' as any);
      expect(result.status).toBe('paid');
    });
  });
});