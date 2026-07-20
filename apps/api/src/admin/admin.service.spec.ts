import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { AdminService } from './admin.service';

const mockPrisma: any = {
  campaign: {
    findMany: vi.fn(),
  },
  device: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  deviceRecoveryToken: {
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
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
    count: vi.fn().mockResolvedValue(0),
  },
  platformLedger: {
    groupBy: vi.fn(),
    create: vi.fn(),
  },
  payoutRequest: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  payoutAccount: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  fraudFlag: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  payoutAllocation: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (callback: any) => callback(mockPrisma)),
};

describe('AdminService', () => {
  let service: AdminService;
  const mockAudit = {
    log: vi.fn().mockResolvedValue(undefined),
    logStrict: vi.fn().mockResolvedValue(undefined),
  };
  const mockFraud = { computeTrustScore: vi.fn() };
  const mockEmail = {
    sendPayoutAccountFrozenAlert: vi.fn().mockResolvedValue({ delivered: true, driver: 'console' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default transaction mock in case a previous test changed it.
    mockPrisma.$transaction = vi.fn(async (callback: any) => callback(mockPrisma));
    service = new AdminService(
      mockPrisma,
      mockAudit as any,
      {} as any,
      mockFraud as any,
      {} as any,
      mockEmail as any,
    );
  });

  describe('getMoneyIntegrityReport', () => {
    it('reconciles global money integrity and negative developer balances by currency', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([
        { id: 'campaign-usd', name: 'USD campaign', budgetSpentMinor: 100, currency: 'USD' },
        { id: 'campaign-eur', name: 'EUR campaign', budgetSpentMinor: 200, currency: 'EUR' },
      ]);
      // advertiserLedger.groupBy call order in getMoneyIntegrityReport:
      //   1. totalAdvertiserDebit    (entryType debit, status confirmed/paid)
      //   2. totalAdvertiserRefund    (entryType refund, status confirmed/paid)
      //   3. totalAdvertiserCredit    (entryType credit, status confirmed)
      //   4. totalAdvertiserReversal  (entryType reversal, status confirmed/reversed)
      // The spend-vs-debit campaign join now runs through $queryRaw, not groupBy.
      mockPrisma.advertiserLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 100 } },
          { currency: 'EUR', _sum: { amountMinor: 200 } },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // totalAdvertiserCredit
        .mockResolvedValueOnce([]); // totalAdvertiserReversal
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 60 } },
          { currency: 'EUR', _sum: { amountMinor: 120 } },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ userId: 'dev-1', currency: 'EUR', _sum: { amountMinor: 100 } }])
        .mockResolvedValueOnce([{ userId: 'dev-1', currency: 'EUR', _sum: { amountMinor: 150 } }]);
      // platformLedger.groupBy is called in this order by getMoneyIntegrityReport:
      //   1. totalPlatformCredit   (platform_fee credit)
      //   2. totalPlatformReversal (platform_fee reversal)
      //   3. totalReserveCredit     (fraud_reserve credit)
      //   4. totalReserveReversal   (fraud_reserve reversal)
      //   5. totalCashCredit        (cash credit)        — advertiser deposit cash bucket
      //   6. totalCashReversal      (cash reversal)
      //   7. totalReferralBonusCredit   (referral_bonus credit)
      //   8. totalReferralBonusReversal (referral_bonus reversal)
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
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // totalCashCredit
        .mockResolvedValueOnce([]) // totalCashReversal
        .mockResolvedValueOnce([]) // totalReferralBonusCredit
        .mockResolvedValueOnce([]); // totalReferralBonusReversal
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'dev-1', email: 'dev@example.com' }]);
      // $queryRaw call order in getMoneyIntegrityReport:
      //   1. campaign discrepancies (WITH debits join) -> empty
      //   2. negative developer balances (WITH balances join) -> dev-1
      mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          userId: 'dev-1',
          email: 'dev@example.com',
          balanceMinor: -50n,
          currency: 'EUR',
          total: 1n,
        },
      ]);

      const report = await service.getMoneyIntegrityReport();

      expect(report.campaignDiscrepancies).toEqual([]);
      expect(report.globalReconciliationByCurrency).toEqual({
        EUR: {
          netAdvertiserSpendMinor: 200n,
          netAdvertiserPositionMinor: -200n,
          netDeveloperEarningsMinor: 120n,
          netPlatformFeeMinor: 60n,
          netReserveMinor: 20n,
          netCashMinor: 0n,
          netReferralBonusMinor: 0n,
          splitSumMinor: 200n,
          discrepancyMinor: 0n,
        },
        USD: {
          netAdvertiserSpendMinor: 100n,
          netAdvertiserPositionMinor: -100n,
          netDeveloperEarningsMinor: 60n,
          netPlatformFeeMinor: 30n,
          netReserveMinor: 10n,
          netCashMinor: 0n,
          netReferralBonusMinor: 0n,
          splitSumMinor: 100n,
          discrepancyMinor: 0n,
        },
      });
      expect(report.negativeDeveloperBalances).toEqual([
        { userId: 'dev-1', email: 'dev@example.com', balanceMinor: -50n, currency: 'EUR' },
      ]);
      expect(report.status).toBe('unhealthy');
    });
  });

  describe('getPendingArchiveRefunds', () => {
    it('lists only pending archive refund obligations with admin context', async () => {
      const rows = [{ id: 'refund-entry-1' }];
      mockPrisma.advertiserLedger.findMany.mockResolvedValue(rows);

      await expect(service.getPendingArchiveRefunds()).resolves.toEqual({
        items: rows,
        total: 0,
        page: 1,
        limit: 20,
        hasMore: false,
      });

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
        skip: 0,
        take: 20,
      });
    });
  });

  describe('confirmArchiveRefund', () => {
    it('rejects legacy archive obligations without posting duplicate refund ledgers', async () => {
      await expect(
        service.confirmArchiveRefund({
          entryId: 'refund-entry-1',
          stripeRefundPaymentIntentId: 'pi_refund_123',
        }),
      ).rejects.toThrow(/campaign budgets are not escrowed/i);

      expect(mockPrisma.advertiserLedger.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.advertiserLedger.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.platformLedger.create).not.toHaveBeenCalled();
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
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        requestedAmountMinor: 5000,
        currency: 'USD',
      });

      await expect(service.approvePayout('pay_1', 'admin_1', 'too much', 9000)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockPrisma.payoutRequest.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a non-positive approved amount', async () => {
      await expect(service.approvePayout('pay_1', 'admin_1', 'bad', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.approvePayout('pay_1', 'admin_1', 'bad', -100)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects approval when the payout is not in a reviewable state', async () => {
      mockPrisma.payoutRequest.findUnique
        .mockResolvedValueOnce({ requestedAmountMinor: 5000, currency: 'USD' })
        .mockResolvedValueOnce({ id: 'pay_1', status: 'paid' }); // already paid → count 0
      mockPrisma.payoutRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approvePayout('pay_1', 'admin_1', 'late')).rejects.toThrow(
        /cannot be approved from status 'paid'/,
      );
    });

    it('rejects approval for a missing payout', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(null);

      await expect(service.approvePayout('ghost', 'admin_1')).rejects.toThrow('Payout not found');
    });
  });

  describe('getUsers response shape', () => {
    it('returns the actual user fields plus an open fraud-flag count', async () => {
      const createdAt1 = new Date('2026-07-01T00:00:00Z');
      const createdAt2 = new Date('2026-07-02T00:00:00Z');
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          email: 'a@x.com',
          name: 'Alice',
          role: 'developer',
          status: 'active',
          trustLevel: 'high_trust',
          country: 'US',
          createdAt: createdAt1,
        },
        {
          id: 'u2',
          email: 'b@x.com',
          name: null,
          role: 'advertiser',
          status: 'active',
          trustLevel: 'low_trust',
          country: null,
          createdAt: createdAt2,
        },
      ]);
      mockPrisma.fraudFlag.groupBy.mockResolvedValue([{ userId: 'u1', _count: { _all: 2 } }]);

      const users = await service.getUsers({});

      expect(users).toHaveLength(2);
      // A-025: the returned user objects must include the exact fields the
      // admin ops view renders — id, role, status, email, name, trustLevel,
      // country, createdAt, plus a computed numeric openFlags count.
      for (const u of users) {
        expect(u).toHaveProperty('id');
        expect(u).toHaveProperty('role');
        expect(u).toHaveProperty('status');
        expect(u).toHaveProperty('email');
        expect(u).toHaveProperty('name');
        expect(u).toHaveProperty('trustLevel');
        expect(u).toHaveProperty('country');
        expect(u).toHaveProperty('createdAt');
        expect(u).toHaveProperty('openFlags');
        expect(typeof u.openFlags).toBe('number');
      }
      expect(users[0]).toMatchObject({
        id: 'u1',
        email: 'a@x.com',
        name: 'Alice',
        role: 'developer',
        status: 'active',
        trustLevel: 'high_trust',
        country: 'US',
        openFlags: 2,
      });
      expect(users[0].createdAt).toBe(createdAt1);
      expect(users[1].createdAt).toBe(createdAt2);
      // A user with no open flags reports 0, not undefined.
      expect(users[1].openFlags).toBe(0);
      expect(users[1].country).toBeNull();
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

      expect(mockPrisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { lastSeenAt: 'desc' },
          skip: 0,
          take: 10,
          where: expect.objectContaining({ AND: expect.any(Array) }),
        }),
      );
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
      await expect(service.getDevices({ toolType: 'not-a-tool' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.device.findMany).not.toHaveBeenCalled();
    });
  });

  describe('issueDeviceRecoveryToken (A-027)', () => {
    const validDevice = {
      id: 'device-1',
      userId: 'user-1',
      fingerprintHash: 'fp-1',
      eventSecret: 'secret-1',
      user: { id: 'user-1', email: 'dev@example.com', role: 'developer', status: 'active' },
    };

    it('issues a non-empty recovery token for a developer device', async () => {
      mockPrisma.device.findUnique.mockResolvedValue(validDevice);
      mockPrisma.deviceRecoveryToken.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.deviceRecoveryToken.create.mockResolvedValue({ id: 'token-new' });

      const result = await service.issueDeviceRecoveryToken({
        deviceId: 'device-1',
        userId: 'user-1',
        reviewerId: 'admin-1',
        reviewerRole: 'admin',
        reason: 'lost laptop',
      });

      expect(mockPrisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        select: expect.objectContaining({ id: true, userId: true, eventSecret: true }),
      });
      // Token is created, prior active tokens revoked, and audit row written.
      expect(mockPrisma.deviceRecoveryToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      );
      expect(mockPrisma.deviceRecoveryToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'lost laptop' }) }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'device_recovery_token_issued', targetId: 'device-1' }),
      );
      expect(typeof result.recoverySupportToken).toBe('string');
      expect(result.recoverySupportToken.length).toBeGreaterThan(0);
      expect(result.tokenId).toBe('token-new');
      expect(result.userId).toBe('user-1');
      expect(result.deviceId).toBe('device-1');
    });

    it('rejects an invalid device id (not found for the user)', async () => {
      mockPrisma.device.findUnique.mockResolvedValue(null);

      await expect(
        service.issueDeviceRecoveryToken({
          deviceId: 'ghost',
          userId: 'user-1',
          reviewerId: 'admin-1',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.deviceRecoveryToken.create).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('rejects a device that does not belong to the requested user', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({ ...validDevice, userId: 'other-user' });

      await expect(
        service.issueDeviceRecoveryToken({
          deviceId: 'device-1',
          userId: 'user-1',
          reviewerId: 'admin-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recomputeTrustScore (A-046)', () => {
    it('surfaces a failure when FraudService.computeTrustScore throws', async () => {
      mockFraud.computeTrustScore.mockRejectedValue(new Error('fraud db down'));

      await expect(service.recomputeTrustScore('user-1')).rejects.toThrow('fraud db down');
    });

    it('returns the updated trust score on success so callers can refresh', async () => {
      mockFraud.computeTrustScore.mockResolvedValue(82);

      await expect(service.recomputeTrustScore('user-1')).resolves.toBe(82);
      expect(mockFraud.computeTrustScore).toHaveBeenCalledWith('user-1');
    });
  });

  describe('payout account verification and freeze', () => {
    it('verifies a payout account and audits the action', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({
        id: 'pa-1',
        isVerified: false,
        provider: 'wise',
        destination: 'wise-dest',
        user: { id: 'u1', email: 'dev@example.com' },
      });
      mockPrisma.payoutAccount.update.mockResolvedValue({ id: 'pa-1', isVerified: true });

      const result = await service.setPayoutAccountVerified(
        'admin-1',
        'admin',
        'pa-1',
        true,
        'ownership confirmed',
      );

      expect(result.isVerified).toBe(true);
      expect(mockPrisma.payoutAccount.update).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
        data: { isVerified: true },
      });
      expect(mockAudit.logStrict).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout_account_verified',
          targetId: 'pa-1',
          afterSnap: expect.objectContaining({ reason: 'ownership confirmed' }),
        }),
        expect.anything(),
      );
    });

    it('rejects a payout account verification for a missing account', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.setPayoutAccountVerified('admin-1', 'admin', 'ghost', true),
      ).rejects.toThrow('Payout account not found');
    });

    it('throws NotFoundException (404) for a missing payout account', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(null);
      await expect(
        service.setPayoutAccountVerified('admin-1', 'admin', 'ghost', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException (404) when freezing a missing account', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(null);
      await expect(
        service.freezePayoutAccount('admin-1', 'admin', 'ghost', 'reason'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException (404) when unfreezing a missing account', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(null);
      await expect(
        service.unfreezePayoutAccount('admin-1', 'admin', 'ghost', 'reason'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('freezes a payout account and blocks its use', async () => {
      const account = {
        id: 'pa-1',
        isFrozen: false,
        provider: 'wise',
        destination: 'wise-dest',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique
        .mockResolvedValueOnce(account)
        .mockResolvedValueOnce({ ...account, isFrozen: true });
      mockPrisma.payoutAccount.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.freezePayoutAccount(
        'admin-1',
        'admin',
        'pa-1',
        'suspected takeover',
      );

      expect(result.isFrozen).toBe(true);
      expect(mockPrisma.payoutAccount.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pa-1',
          isFrozen: false,
          initiationPayoutId: null,
        },
        data: {
          isFrozen: true,
        },
      });
      expect(mockAudit.logStrict).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout_account_frozen',
          targetId: 'pa-1',
          afterSnap: expect.objectContaining({ reason: 'suspected takeover' }),
        }),
        expect.anything(),
      );
    });

    it('returns a conflict when provider initiation holds the durable fence', async () => {
      const activeFence = {
        id: 'pa-1',
        isFrozen: false,
        initiationPayoutId: '11111111-1111-4111-8111-111111111111',
        provider: 'wise',
        destination: 'wise-dest',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique
        .mockResolvedValueOnce(activeFence)
        .mockResolvedValueOnce(activeFence);
      mockPrisma.payoutAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.freezePayoutAccount('admin-1', 'admin', 'pa-1', 'suspected takeover'),
      ).rejects.toThrow('has an active or ambiguous provider initiation');

      expect(mockPrisma.payoutAccount.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pa-1',
          isFrozen: false,
          initiationPayoutId: null,
        },
        data: {
          isFrozen: true,
        },
      });
      expect(mockAudit.log).not.toHaveBeenCalled();
      expect(mockEmail.sendPayoutAccountFrozenAlert).not.toHaveBeenCalled();
    });

    it('unfreezes a payout account so it can be used again', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({
        id: 'pa-1',
        isFrozen: true,
        provider: 'wise',
        destination: 'wise-dest',
        user: { id: 'u1', email: 'dev@example.com' },
      });
      mockPrisma.payoutAccount.update.mockResolvedValue({ id: 'pa-1', isFrozen: false });

      const result = await service.unfreezePayoutAccount('admin-1', 'admin', 'pa-1', 'cleared');

      expect(result.isFrozen).toBe(false);
      expect(mockPrisma.payoutAccount.update).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
        data: { isFrozen: false },
      });
      expect(mockAudit.logStrict).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout_account_unfrozen',
          targetId: 'pa-1',
          afterSnap: expect.objectContaining({ reason: 'cleared' }),
        }),
        expect.anything(),
      );
    });

    it('rejects re-freeze of an already-frozen account with ConflictException (409)', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({
        id: 'pa-1',
        isFrozen: true,
        isVerified: true,
        provider: 'wise',
        destination: 'wise-dest',
        user: { id: 'u1', email: 'dev@example.com' },
      });

      await expect(
        service.freezePayoutAccount('admin-1', 'admin', 'pa-1', 'duplicate'),
      ).rejects.toBeInstanceOf(ConflictException);

      // No update or audit emission on the conflict path.
      expect(mockPrisma.payoutAccount.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payoutAccount.update).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('rejects unfreeze of a non-frozen account with ConflictException (409)', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({
        id: 'pa-1',
        isFrozen: false,
        isVerified: true,
        provider: 'wise',
        destination: 'wise-dest',
        user: { id: 'u1', email: 'dev@example.com' },
      });

      await expect(
        service.unfreezePayoutAccount('admin-1', 'admin', 'pa-1', 'duplicate'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.payoutAccount.update).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('fires a payout-account-frozen alert email after freezing (A-086)', async () => {
      const account = {
        id: 'pa-1',
        isFrozen: false,
        isVerified: true,
        provider: 'wise',
        destination: 'wise-dest',
        currency: 'USD',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique
        .mockResolvedValueOnce(account)
        .mockResolvedValueOnce({ ...account, isFrozen: true });
      mockPrisma.payoutAccount.updateMany.mockResolvedValue({ count: 1 });

      await service.freezePayoutAccount('admin-1', 'admin', 'pa-1', 'suspected takeover');

      // Drain microtasks so the fire-and-forget .catch chain settles before
      // asserting the mock was called. vi.fn() is sync, so one tick suffices.
      await new Promise((r) => process.nextTick(r));
      expect(mockEmail.sendPayoutAccountFrozenAlert).toHaveBeenCalledTimes(1);
      expect(mockEmail.sendPayoutAccountFrozenAlert).toHaveBeenCalledWith(
        'dev@example.com',
        expect.objectContaining({
          provider: 'wise',
          destination: 'wise-dest',
          currency: 'USD',
          actorRole: 'admin',
          reason: 'suspected takeover',
          time: expect.any(String),
        }),
      );
      expect(mockAudit.logStrict).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout_account_frozen' }),
        expect.anything(),
      );
    });

    it('still completes freeze when email.send rejects (best-effort)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const account = {
          id: 'pa-1',
          isFrozen: false,
          isVerified: true,
          provider: 'wise',
          destination: 'wise-dest',
          currency: 'USD',
          user: { id: 'u1', email: 'dev@example.com' },
        };
        mockPrisma.payoutAccount.findUnique
          .mockResolvedValueOnce(account)
          .mockResolvedValueOnce({ ...account, isFrozen: true });
        mockPrisma.payoutAccount.updateMany.mockResolvedValue({ count: 1 });
        mockEmail.sendPayoutAccountFrozenAlert.mockRejectedValueOnce(new Error('resend down'));

        await expect(
          service.freezePayoutAccount('admin-1', 'admin', 'pa-1', 'incidents'),
        ).resolves.toMatchObject({ id: 'pa-1' });
        expect(mockPrisma.payoutAccount.updateMany).toHaveBeenCalledWith({
          where: expect.objectContaining({
            id: 'pa-1',
            isFrozen: false,
          }),
          data: {
            isFrozen: true,
          },
        });
        expect(mockAudit.logStrict).toHaveBeenCalled();
        // Drain microtasks so the .catch(console.warn) runs before the spy check.
        await new Promise((r) => process.nextTick(r));
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('payout-account-frozen email delivery failed'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('lists accounts with an active provider-initiation fence, including reconciliation telemetry', async () => {
      const fenced = [
        {
          id: 'pa-fenced',
          userId: 'u1',
          provider: 'wise',
          destination: 'wise-dest',
          currency: 'USD',
          isVerified: true,
          isActive: true,
          isFrozen: false,
          initiationPayoutId: 'payout-1',
          user: { id: 'u1', email: 'dev@example.com' },
        },
      ];
      const initiationPayout = {
        id: 'payout-1',
        reconciliationAttempts: 3,
        lastReconciliationAt: new Date('2026-07-19T10:00:00.000Z'),
        escalatedAt: null,
      };
      mockPrisma.payoutAccount.findMany.mockResolvedValue(fenced);
      mockPrisma.payoutAccount.count.mockResolvedValue(2);
      mockPrisma.payoutRequest.findMany.mockResolvedValue([initiationPayout]);

      const result = await service.getFencedAccounts({ page: 1, limit: 10 });

      expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith({
        where: { initiationPayoutId: { not: null } },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(mockPrisma.payoutRequest.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['payout-1'] } },
        select: {
          id: true,
          currency: true,
          reconciliationAttempts: true,
          lastReconciliationAt: true,
          escalatedAt: true,
        },
      });
      expect(mockPrisma.payoutAccount.count).toHaveBeenCalledWith({
        where: { initiationPayoutId: { not: null } },
      });
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.items).toHaveLength(1);
      // P1.11: the fenced-account view surfaces reconciliation metadata.
      expect(result.items[0]).toMatchObject({
        id: 'pa-fenced',
        initiationPayoutId: 'payout-1',
        reconciliationAttempts: 3,
        lastReconciliationAt: '2026-07-19T10:00:00.000Z',
        escalatedAt: null,
      });
    });

    it('applies default pagination when no params are provided', async () => {
      const fenced: unknown[] = [];
      mockPrisma.payoutAccount.findMany.mockResolvedValue(fenced);
      mockPrisma.payoutAccount.count.mockResolvedValue(0);

      await service.getFencedAccounts();

      expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith({
        where: { initiationPayoutId: { not: null } },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 50,
      });
    });

    it('clamps pagination limit to a maximum of 100', async () => {
      const fenced: unknown[] = [];
      mockPrisma.payoutAccount.findMany.mockResolvedValue(fenced);
      mockPrisma.payoutAccount.count.mockResolvedValue(0);

      await service.getFencedAccounts({ page: 2, limit: 200 });

      expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith({
        where: { initiationPayoutId: { not: null } },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: 100,
        take: 100,
      });
    });

    it.each([
      { status: 'paid', allowed: true },
      { status: 'failed', allowed: true },
      { status: 'rejected', allowed: true },
      { status: 'cancelled', allowed: true },
      { status: 'processing', allowed: false },
      { status: 'requested', allowed: false },
      { status: 'under_review', allowed: false },
      { status: 'approved', allowed: false },
    ])(
      'releases fence only when referenced payout is terminal ($status -> $allowed)',
      async ({ status, allowed }) => {
        const account = {
          id: 'pa-1',
          provider: 'wise',
          destination: 'wise-dest',
          initiationPayoutId: 'payout-1',
          user: { id: 'u1', email: 'dev@example.com' },
        };
        mockPrisma.payoutAccount.findUnique.mockResolvedValue(account);
        mockPrisma.payoutRequest.findUnique.mockResolvedValue({ status });
        mockPrisma.payoutAccount.update.mockResolvedValue({
          ...account,
          initiationPayoutId: null,
        });

        if (allowed) {
          const result = await service.releasePayoutFence({
            payoutAccountId: 'pa-1',
            reviewerId: 'admin-1',
            reviewerRole: 'admin',
            reason: 'provider outcome confirmed',
            providerTxId: 'provider-tx-123',
            resolution: 'paid',
          });
          expect(result.initiationPayoutId).toBeNull();
          expect(mockPrisma.payoutAccount.update).toHaveBeenCalledWith({
            where: { id: 'pa-1' },
            data: { initiationPayoutId: null },
          });
          expect(mockAudit.logStrict).toHaveBeenCalledWith(
            expect.objectContaining({
              action: 'release_payout_fence',
              afterSnap: expect.objectContaining({
                observedPayoutStatus: status,
                providerTxId: 'provider-tx-123',
                resolution: 'paid',
              }),
            }),
            expect.anything(),
          );
        } else {
          await expect(
            service.releasePayoutFence({
              payoutAccountId: 'pa-1',
              reviewerId: 'admin-1',
              reviewerRole: 'admin',
              reason: 'provider outcome confirmed',
            }),
          ).rejects.toThrow(/confirm the provider outcome/);
          expect(mockPrisma.payoutAccount.update).not.toHaveBeenCalled();
        }
      },
    );

    it('releases a fence without optional providerTxId/resolution', async () => {
      const account = {
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: 'payout-1',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(account);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({ status: 'paid' });
      mockPrisma.payoutAccount.update.mockResolvedValue({
        ...account,
        initiationPayoutId: null,
      });

      await service.releasePayoutFence({
        payoutAccountId: 'pa-1',
        reviewerId: 'admin-1',
        reviewerRole: 'admin',
        reason: 'provider outcome confirmed',
      });

      expect(mockAudit.logStrict).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'release_payout_fence',
          afterSnap: expect.objectContaining({
            observedPayoutStatus: 'paid',
            providerTxId: null,
            resolution: null,
          }),
        }),
        expect.anything(),
      );
    });

    it('rejects fence release when the referenced payout no longer exists', async () => {
      const account = {
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: 'payout-1',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(account);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.releasePayoutFence({
          payoutAccountId: 'pa-1',
          reviewerId: 'admin-1',
          reviewerRole: 'admin',
          reason: 'payout was deleted',
        }),
      ).rejects.toThrow('no longer exists');

      expect(mockPrisma.payoutAccount.update).not.toHaveBeenCalled();
    });

    it('rejects releasing a fence for an account without an active fence', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue({
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: null,
        user: { id: 'u1', email: 'dev@example.com' },
      });

      await expect(
        service.releasePayoutFence({
          payoutAccountId: 'pa-1',
          reviewerId: 'admin-1',
          reviewerRole: 'admin',
          reason: 'no fence',
        }),
      ).rejects.toThrow('does not have an active initiation fence');
    });

    it('throws NotFoundException when releasing a fence for a missing account', async () => {
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.releasePayoutFence({
          payoutAccountId: 'ghost',
          reviewerId: 'admin-1',
          reviewerRole: 'admin',
          reason: 'missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('leaves the fence intact if the clearing transaction fails', async () => {
      const account = {
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: 'payout-1',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(account);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({ status: 'paid' });
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('database connection lost'));

      await expect(
        service.releasePayoutFence({
          payoutAccountId: 'pa-1',
          reviewerId: 'admin-1',
          reviewerRole: 'admin',
          reason: 'provider outcome confirmed',
        }),
      ).rejects.toThrow('database connection lost');

      // The fence was never cleared — no update could set initiationPayoutId to null.
      expect(mockPrisma.payoutAccount.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { initiationPayoutId: null } }),
      );
      // The account record still carries the fence.
      expect(account.initiationPayoutId).toBe('payout-1');
    });

    it('retains the fence when the referenced payout is still in flight (timeout/crash recovery)', async () => {
      const account = {
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: 'payout-1',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(account);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({ status: 'processing' });

      await expect(
        service.releasePayoutFence({
          payoutAccountId: 'pa-1',
          reviewerId: 'admin-1',
          reviewerRole: 'admin',
          reason: 'provider outcome confirmed',
        }),
      ).rejects.toThrow(/confirm the provider outcome/);

      // The fence stays in place because the payout is non-terminal.
      expect(mockPrisma.payoutAccount.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { initiationPayoutId: null } }),
      );
      // The account record still carries the fence.
      expect(account.initiationPayoutId).toBe('payout-1');
    });
    it('surfaces reconciliation telemetry on the released account (P1.11)', async () => {
      const account = {
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: 'payout-1',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(account);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue({
        status: 'paid',
        reconciliationAttempts: 5,
        lastReconciliationAt: new Date('2026-07-19T12:00:00.000Z'),
        escalatedAt: new Date('2026-07-18T08:30:00.000Z'),
      });
      mockPrisma.payoutAccount.update.mockResolvedValue({
        ...account,
        initiationPayoutId: null,
      });

      const result = await service.releasePayoutFence({
        payoutAccountId: 'pa-1',
        reviewerId: 'admin-1',
        reviewerRole: 'admin',
        reason: 'provider outcome confirmed',
      });

      expect(result.initiationPayoutId).toBeNull();
      // P1.11: reconciliation metadata from the released payout is carried on the response.
      expect(result.reconciliationAttempts).toBe(5);
      expect(result.lastReconciliationAt).toBe('2026-07-19T12:00:00.000Z');
      expect(result.escalatedAt).toBe('2026-07-18T08:30:00.000Z');
    });
    it('requires a distinct second approver for high-value fence releases (P1.11)', async () => {
      const account = {
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: 'payout-1',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      const highValuePayout = {
        status: 'paid',
        currency: 'USD',
        approvedAmountMinor: 50_000_00n,
        requestedAmountMinor: 50_000_00n,
        reconciliationAttempts: 3,
        lastReconciliationAt: null,
        escalatedAt: null,
      };
      mockPrisma.payoutAccount.findUnique.mockResolvedValue(account);
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(highValuePayout);
      mockPrisma.payoutAccount.update.mockResolvedValue({
        ...account,
        initiationPayoutId: null,
      });

      // No second approver -> rejected.
      await expect(
        service.releasePayoutFence({
          payoutAccountId: 'pa-1',
          reviewerId: 'admin-1',
          reviewerRole: 'admin',
          reason: 'high value release',
        }),
      ).rejects.toThrow(/High-value fence release/);

      // Second approver identical to releaser -> rejected.
      await expect(
        service.releasePayoutFence({
          payoutAccountId: 'pa-1',
          reviewerId: 'admin-1',
          reviewerRole: 'admin',
          reason: 'high value release',
          secondApproverId: 'admin-1',
        }),
      ).rejects.toThrow(/distinct/);

      // Distinct second approver -> succeeds and is recorded in the audit.
      const result = await service.releasePayoutFence({
        payoutAccountId: 'pa-1',
        reviewerId: 'admin-1',
        reviewerRole: 'admin',
        reason: 'high value release',
        secondApproverId: 'admin-2',
      });
      expect(result.initiationPayoutId).toBeNull();
      expect(mockAudit.logStrict).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'release_payout_fence',
          afterSnap: expect.objectContaining({ secondApproverId: 'admin-2' }),
        }),
        expect.anything(),
      );
    });
    it('surfaces associated active fraud flags and ledger allocations on fenced accounts (P1.11)', async () => {
      const account = {
        id: 'pa-1',
        provider: 'wise',
        destination: 'wise-dest',
        initiationPayoutId: 'payout-1',
        user: { id: 'u1', email: 'dev@example.com' },
      };
      mockPrisma.payoutAccount.findMany.mockResolvedValue([account]);
      mockPrisma.payoutAccount.count.mockResolvedValue(1);
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'payout-1',
          currency: 'USD',
          reconciliationAttempts: 2,
          lastReconciliationAt: null,
          escalatedAt: null,
        },
      ]);
      mockPrisma.fraudFlag.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u1' }]);
      mockPrisma.payoutAllocation.findMany.mockResolvedValue([
        { payoutRequestId: 'payout-1', amountMinor: 1000n },
        { payoutRequestId: 'payout-1', amountMinor: 2000n },
      ]);

      const result = await service.getFencedAccounts();
      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.activeFraudFlags).toBe(2);
      expect(item.ledgerAllocations).toEqual({ count: 2, totalMinor: 3000n, currency: 'USD' });
    });
  });
});
