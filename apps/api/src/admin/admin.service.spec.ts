import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AdminService } from './admin.service';

const mockPrisma: any = {
  campaign: {
    findMany: vi.fn(),
  },
  device: {
    count: vi.fn(),
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
  payoutRequest: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  fraudFlag: {
    groupBy: vi.fn(),
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

  describe('approvePayout', () => {
    it('approves a payout at the full requested amount and records the reviewer', async () => {
      mockPrisma.payoutRequest.findUnique
        .mockResolvedValueOnce({ requestedAmountMinor: 5000, currency: 'USD' }) // pre-update read
        .mockResolvedValueOnce({ id: 'pay_1', status: 'approved', approvedAmountMinor: 5000 }); // post-update read
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approvePayout('pay_1', 'admin_1', 'looks good');

      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay_1', status: { in: ['requested', 'under_review'] } },
        data: {
          status: 'approved',
          reviewerId: 'admin_1',
          reviewNote: 'looks good',
          processedAt: expect.any(Date),
          approvedAmountMinor: 5000,
        },
      });
      expect(result.approvedAmountMinor).toBe(5000);
    });

    it('authorizes a partial approval below the requested amount', async () => {
      mockPrisma.payoutRequest.findUnique
        .mockResolvedValueOnce({ requestedAmountMinor: 5000, currency: 'USD' })
        .mockResolvedValueOnce({ id: 'pay_1', status: 'approved', approvedAmountMinor: 3000 });
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approvePayout('pay_1', 'admin_1', 'partial', 3000);

      expect(mockPrisma.payoutRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approvedAmountMinor: 3000 }),
        }),
      );
      expect(result.approvedAmountMinor).toBe(3000);
    });

    it('rejects a partial approval that exceeds the requested amount', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({ requestedAmountMinor: 5000, currency: 'USD' });

      await expect(
        service.approvePayout('pay_1', 'admin_1', 'too much', 9000),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.payoutRequest.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a non-positive approved amount', async () => {
      await expect(
        service.approvePayout('pay_1', 'admin_1', 'bad', 0),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.approvePayout('pay_1', 'admin_1', 'bad', -100),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects approval when the payout is not in a reviewable state', async () => {
      mockPrisma.payoutRequest.findUnique
        .mockResolvedValueOnce({ requestedAmountMinor: 5000, currency: 'USD' })
        .mockResolvedValueOnce({ id: 'pay_1', status: 'paid' }); // already paid → count 0
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.approvePayout('pay_1', 'admin_1', 'late'),
      ).rejects.toThrow(/cannot be approved from status 'paid'/);
    });

    it('rejects approval for a missing payout', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(null);

      await expect(service.approvePayout('ghost', 'admin_1')).rejects.toThrow(
        'Payout not found',
      );
    });
  });

  describe('getUsers response shape', () => {
    it('returns the actual user fields plus an open fraud-flag count', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'a@x.com', name: 'Alice', role: 'developer', status: 'active', trustLevel: 'high_trust', country: 'US', createdAt: new Date() },
        { id: 'u2', email: 'b@x.com', name: null, role: 'advertiser', status: 'active', trustLevel: 'low_trust', country: null, createdAt: new Date() },
      ]);
      mockPrisma.fraudFlag.groupBy.mockResolvedValue([
        { userId: 'u1', _count: { _all: 2 } },
      ]);

      const users = await service.getUsers({});

      expect(users).toHaveLength(2);
      expect(users[0]).toMatchObject({
        id: 'u1',
        email: 'a@x.com',
        name: 'Alice',
        role: 'developer',
        trustLevel: 'high_trust',
        openFlags: 2,
      });
      // A user with no open flags reports 0, not undefined.
      expect(users[1].openFlags).toBe(0);
    });
  });

  describe('getDevices', () => {
    it('returns searchable devices without exposing event secrets', async () => {
      const createdAt = new Date('2026-07-01T00:00:00Z');
      const lastSeenAt = new Date('2026-07-02T00:00:00Z');
      mockPrisma.device.findMany.mockResolvedValue([
        {
          id: 'device-1',
          userId: 'user-1',
          fingerprintHash: 'fingerprint-1',
          eventSecret: 'server-side-secret',
          toolType: 'vscode',
          extensionVersion: '1.2.3',
          platform: 'linux',
          createdAt,
          lastSeenAt,
          user: {
            id: 'user-1',
            email: 'dev@example.com',
            name: 'Dev User',
            role: 'developer',
            status: 'active',
          },
          recoveryTokens: [
            {
              id: 'token-1',
              reason: 'lost machine',
              expiresAt: new Date('2026-07-02T01:00:00Z'),
              usedAt: null,
              revokedAt: null,
              createdAt: lastSeenAt,
            },
          ],
        },
      ]);
      mockPrisma.device.count.mockResolvedValue(1);

      const result = await service.getDevices({ search: 'dev@example.com', limit: 10 });

      expect(mockPrisma.device.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { lastSeenAt: 'desc' },
        skip: 0,
        take: 10,
        where: expect.objectContaining({ AND: expect.any(Array) }),
      }));
      expect(result).toMatchObject({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        devices: [
          {
            id: 'device-1',
            userId: 'user-1',
            fingerprintHash: 'fingerprint-1',
            hasEventSecret: true,
            toolType: 'vscode',
            extensionVersion: '1.2.3',
            platform: 'linux',
            user: { email: 'dev@example.com' },
            latestRecoveryToken: { id: 'token-1' },
          },
        ],
      });
      expect(result.devices[0]).not.toHaveProperty('eventSecret');
    });

    it('rejects unsupported tool type filters', async () => {
      await expect(service.getDevices({ toolType: 'not-a-tool' })).rejects.toThrow(BadRequestException);
      expect(mockPrisma.device.findMany).not.toHaveBeenCalled();
    });
  });
});
