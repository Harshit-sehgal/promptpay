import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service';

const mockPrisma: any = {
  campaign: {
    findMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  earningsLedger: {
    groupBy: vi.fn(),
  },
  advertiserLedger: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    groupBy: vi.fn(),
    updateMany: vi.fn(),
  },
  platformLedger: {
    groupBy: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(async (callback: any) => callback(mockPrisma)),
};

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdminService(
      mockPrisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('getMoneyIntegrityReport', () => {
    it('reconciles global money integrity and negative developer balances by currency', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([
        { id: 'campaign-usd', name: 'USD campaign', budgetSpentMinor: 100, currency: 'USD' },
        { id: 'campaign-eur', name: 'EUR campaign', budgetSpentMinor: 200, currency: 'EUR' },
      ]);
      mockPrisma.advertiserLedger.groupBy
        .mockResolvedValueOnce([
          { campaignId: 'campaign-usd', currency: 'USD', _sum: { amountMinor: 100 } },
          { campaignId: 'campaign-eur', currency: 'EUR', _sum: { amountMinor: 200 } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 100 } },
          { currency: 'EUR', _sum: { amountMinor: 200 } },
        ])
        .mockResolvedValueOnce([]);
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 60 } },
          { currency: 'EUR', _sum: { amountMinor: 120 } },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ userId: 'dev-1', currency: 'EUR', _sum: { amountMinor: 100 } }])
        .mockResolvedValueOnce([{ userId: 'dev-1', currency: 'EUR', _sum: { amountMinor: 150 } }]);
      mockPrisma.platformLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 30 } },
          { currency: 'EUR', _sum: { amountMinor: 60 } },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 10 } },
          { currency: 'EUR', _sum: { amountMinor: 20 } },
        ])
        .mockResolvedValueOnce([]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'dev-1', email: 'dev@example.com' }]);

      const report = await service.getMoneyIntegrityReport();

      expect(report.campaignDiscrepancies).toEqual([]);
      expect(report.globalReconciliationByCurrency).toEqual({
        EUR: {
          netAdvertiserSpendMinor: 200,
          netDeveloperEarningsMinor: 120,
          netPlatformFeeMinor: 60,
          netReserveMinor: 20,
          splitSumMinor: 200,
          discrepancyMinor: 0,
        },
        USD: {
          netAdvertiserSpendMinor: 100,
          netDeveloperEarningsMinor: 60,
          netPlatformFeeMinor: 30,
          netReserveMinor: 10,
          splitSumMinor: 100,
          discrepancyMinor: 0,
        },
      });
      expect(report.negativeDeveloperBalances).toEqual([
        { userId: 'dev-1', email: 'dev@example.com', balanceMinor: -50, currency: 'EUR' },
      ]);
      expect(report.status).toBe('unhealthy');
    });
  });

  describe('getPendingArchiveRefunds', () => {
    it('lists only pending archive refund obligations with admin context', async () => {
      const rows = [{ id: 'refund-entry-1' }];
      mockPrisma.advertiserLedger.findMany.mockResolvedValue(rows);

      await expect(service.getPendingArchiveRefunds()).resolves.toBe(rows);

      expect(mockPrisma.advertiserLedger.findMany).toHaveBeenCalledWith({
        where: {
          entryType: 'refund',
          status: 'pending',
          idempotencyKey: { startsWith: 'archive_refund_' },
        },
        include: {
          advertiser: {
            select: {
              id: true,
              companyName: true,
              billingEmail: true,
            },
          },
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('confirmArchiveRefund', () => {
    it('trims the Stripe reference before writing advertiser and platform ledger rows', async () => {
      const pendingEntry = {
        id: 'refund-entry-1',
        amountMinor: 1250,
        currency: 'USD',
        idempotencyKey: 'archive_refund_campaign-1',
        status: 'pending',
      };
      const confirmedEntry = {
        ...pendingEntry,
        status: 'confirmed',
        stripePaymentIntentId: 'pi_refund_123',
      };
      mockPrisma.advertiserLedger.findUnique
        .mockResolvedValueOnce(pendingEntry)
        .mockResolvedValueOnce(confirmedEntry);
      mockPrisma.advertiserLedger.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.platformLedger.create.mockResolvedValue({ id: 'platform-ledger-1' });

      const result = await service.confirmArchiveRefund({
        entryId: 'refund-entry-1',
        stripeRefundPaymentIntentId: '  pi_refund_123  ',
      });

      expect(mockPrisma.advertiserLedger.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund-entry-1', status: 'pending' },
        data: {
          status: 'confirmed',
          stripePaymentIntentId: 'pi_refund_123',
        },
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: {
          entryType: 'refund',
          status: 'confirmed',
          amountMinor: 1250,
          currency: 'USD',
          bucket: 'cash',
          referenceId: 'pi_refund_123',
          idempotencyKey: 'archive_refund_plat_refund-entry-1',
          description: expect.stringContaining('pi_refund_123'),
        },
      });
      expect(result).toEqual({ entry: confirmedEntry, confirmed: true });
    });

    it('rejects a blank Stripe reference before touching the ledger', async () => {
      await expect(
        service.confirmArchiveRefund({
          entryId: 'refund-entry-1',
          stripeRefundPaymentIntentId: '   ',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.advertiserLedger.findUnique).not.toHaveBeenCalled();
    });
  });
});
