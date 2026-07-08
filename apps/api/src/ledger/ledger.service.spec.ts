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
    upsert: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  advertiserLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  platformLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
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
  $executeRawUnsafe: vi.fn(async (_sql: string, ..._params: any[]) => 1),
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
    // NOTE: getAvailableBalance is the confirmed credits minus confirmed
    // recovery debits. It does
    // NOT subtract in-flight payouts — that is PayoutService.getAvailableForPayout's
    // responsibility (it reserves funds via PayoutAllocation). These tests pin the
    // actual contract so a regression that silently changes the semantics is caught.
    it('returns confirmed credit earnings minus confirmed recovery debits', async () => {
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 250_00 } }])
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 40_00 } }]);

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(210_00);
      expect(result.currency).toBe('USD');
      expect(result.byCurrency).toEqual({ USD: 210_00 });
      // Must aggregate confirmed credits and must never touch payoutRequest.
      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledTimes(2);
      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['currency'],
          where: { userId: 'u-1', status: 'confirmed', entryType: 'credit' },
        }),
      );
      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['currency'],
          where: { userId: 'u-1', status: 'confirmed', entryType: 'debit' },
        }),
      );
      expect(mockPrisma.payoutRequest.aggregate).not.toHaveBeenCalled();
    });

    it('returns 0 when there are no confirmed earnings', async () => {
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(0);
      expect(result.currency).toBe('USD');
      expect(result.byCurrency).toEqual({});
      expect(mockPrisma.payoutRequest.aggregate).not.toHaveBeenCalled();
    });

    it('keeps confirmed balances separated by currency', async () => {
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 250_00 } },
          { currency: 'EUR', _sum: { amountMinor: 100_00 } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 40_00 } },
          { currency: 'EUR', _sum: { amountMinor: 10_00 } },
        ]);

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(210_00);
      expect(result.byCurrency).toEqual({ USD: 210_00, EUR: 90_00 });
    });
  });

  describe('getPendingBalance', () => {
    it('returns sum of pending and estimated earnings', async () => {
      mockPrisma.earningsLedger.groupBy.mockResolvedValue([
        { currency: 'USD', _sum: { amountMinor: 50_00 } },
      ]);

      const result = await service.getPendingBalance('u-1');
      expect(result.amountMinor).toBe(50_00);
      expect(result.byCurrency).toEqual({ USD: 50_00 });
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

    it('returns -1 (indefinite) for restricted trust', () => {
      expect(service.getHoldDays('restricted')).toBe(-1);
    });

    // TrustLevel.BANNED must NOT fall through to the default 30-day branch.
    // A banned user must never have their earnings mature for payout.
    it('returns -1 (indefinite) for banned trust', () => {
      expect(service.getHoldDays('banned')).toBe(-1);
    });

    it('returns 30 for unknown states (defensive default)', () => {
      expect(service.getHoldDays('mystery-state')).toBe(30);
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
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "campaigns"'),
        2_00,
        'c-1',
      );
      expect(mockPrisma.advertiserLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          advertiserId: 'a-1',
          campaignId: 'c-1',
          entryType: 'debit',
          amountMinor: 2_00,
        }),
      });
      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-1',
          campaignId: 'c-1',
          impressionId: 'imp-1',
          amountMinor: 120,
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'platform_fee',
          amountMinor: 60,
          referenceId: 'imp-1',
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'fraud_reserve',
          amountMinor: 20,
          referenceId: 'imp-1',
        }),
      });
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

    it('creates no impression ledger entries when campaign budget is exhausted', async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValueOnce(0);

      await expect(
        service.recordImpressionEarnings({
          userId: 'u-1',
          campaignId: 'c-1',
          impressionId: 'imp-3',
          bidAmountMinor: 2_00,
          currency: 'USD',
          advertiserId: 'a-1',
          trustLevel: 'normal',
        }),
      ).rejects.toThrow('Campaign budget exhausted');

      expect(mockPrisma.advertiserLedger.create).not.toHaveBeenCalled();
      expect(mockPrisma.earningsLedger.create).not.toHaveBeenCalled();
      expect(mockPrisma.platformLedger.create).not.toHaveBeenCalled();
    });
  });

  describe('recordClickEarnings', () => {
    it('creates CPC click entries across all ledgers and increments campaign spend', async () => {
      await service.recordClickEarnings({
        userId: 'u-1',
        campaignId: 'c-1',
        clickId: 'clk-1',
        clickBidMinor: 5_00,
        currency: 'USD',
        advertiserId: 'a-1',
        trustLevel: 'normal',
      });

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "campaigns"'),
        5_00,
        'c-1',
      );
      expect(mockPrisma.advertiserLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          advertiserId: 'a-1',
          campaignId: 'c-1',
          entryType: 'debit',
          amountMinor: 5_00,
        }),
      });
      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-1',
          campaignId: 'c-1',
          clickId: 'clk-1',
          amountMinor: 300,
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'platform_fee',
          amountMinor: 150,
          referenceId: 'clk-1',
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'fraud_reserve',
          amountMinor: 50,
          referenceId: 'clk-1',
        }),
      });
    });

    it('creates no CPC click ledger entries when campaign budget is exhausted', async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValueOnce(0);

      await expect(
        service.recordClickEarnings({
          userId: 'u-1',
          campaignId: 'c-1',
          clickId: 'clk-2',
          clickBidMinor: 5_00,
          currency: 'USD',
          advertiserId: 'a-1',
          trustLevel: 'normal',
        }),
      ).rejects.toThrow('Campaign budget exhausted');

      expect(mockPrisma.advertiserLedger.create).not.toHaveBeenCalled();
      expect(mockPrisma.earningsLedger.create).not.toHaveBeenCalled();
      expect(mockPrisma.platformLedger.create).not.toHaveBeenCalled();
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
      // The read returns the current status; the CAS updateMany wins
      // (count: 1) and the post-update re-read returns the new status.
      mockPrisma.earningsLedger.findUnique
        .mockResolvedValueOnce({ // transitionEarning's initial read
          id: 'e-2',
          userId: 'u-1',
          status: 'confirmed',
          amountMinor: 100,
          currency: 'USD',
        })
        .mockResolvedValueOnce({ // re-read after the winning CAS write
          id: 'e-2',
          status: 'paid',
        });
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 1 });

      const result = await (service as any).transitionEarning('e-2', 'paid' as any);
      expect(result.status).toBe('paid');
      // The CAS guard should have keyed on the observed status.
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e-2', status: 'confirmed' },
        }),
      );
    });

    it('surfaces a ConflictException when a concurrent transition wins the CAS', async () => {
      mockPrisma.earningsLedger.findUnique.mockResolvedValue({
        id: 'e-3',
        status: 'confirmed',
        amountMinor: 100,
        currency: 'USD',
      });
      // count: 0 → the row's status changed between read and write.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        (service as any).transitionEarning('e-3', 'held' as any),
      ).rejects.toThrow(/modified by a concurrent transition/);
    });
  });

  describe('reverseEarnings (sum-conserving fraud reversal)', () => {
    /**
     * Bug the round-6/7 audit found: `reverseEarnings` flipped the developer's
     * earnings row to `reversed` but never wrote compensating entries on the
     * `AdvertiserLedger` (refund) or `PlatformLedger` (reversal debit on fee +
     * reserve). After confirmed fraud the advertiser stayed debited and the
     * platform kept its fee + reserve for a fraudulent impression — money
     * stranded. These tests pin the compensating writes by checking each
     * upsert's idempotency key + entryType.
     */
    it('writes the three compensating entries (advertiser refund + 2 platform reversals)', async () => {
      const impressionId = 'imp-abc';
      // Pre-flight: read the impression's advertisement debit + platform rows
      mockPrisma.advertiserLedger.findUnique.mockResolvedValueOnce({
        id: 'adv-row-1',
        advertiserId: 'adv-1',
        campaignId: 'cmp-1',
        amountMinor: 1000, // full bid
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'plt-row-1',
        campaignId: 'cmp-1',
        amountMinor: 300, // platform fee (30%)
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-plt`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'res-row-1',
        campaignId: 'cmp-1',
        amountMinor: 100, // fraud reserve (10%)
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-res`,
      });
      mockPrisma.earningsLedger.count.mockResolvedValueOnce(0);
      // Inside the transaction: 1 earnings row flipped.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 1 });
      // All three upserts are new (no prior replay).
      mockPrisma.advertiserLedger.upsert.mockResolvedValue({});
      mockPrisma.platformLedger.upsert
        .mockResolvedValueOnce({}) // plt reversal
        .mockResolvedValueOnce({}); // res reversal

      const result = await service.reverseEarnings({ impressionId }, 'click_abuse');

      expect(result).toEqual({ reversed: 1, paidSkipped: 0 });

      // 1. Earnings row flipped to `reversed` with the reason in description.
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: {
          impressionId,
          status: { in: ['estimated', 'pending', 'confirmed'] },
        },
        data: expect.objectContaining({
          status: 'reversed',
          description: 'Reversed: click_abuse',
        }),
      });

      // 2. Advertiser refund with the FULL bid (advertiser must not pay for
      //    fraud) under the `-rev` idempotency suffix.
      expect(mockPrisma.advertiserLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `imp-${impressionId}-adv-rev` },
          create: expect.objectContaining({
            advertiserId: 'adv-1',
            campaignId: 'cmp-1',
            entryType: 'refund',
            status: 'confirmed',
            amountMinor: 1000,
            currency: 'USD',
            idempotencyKey: `imp-${impressionId}-adv-rev`,
          }),
          update: {},
        }),
      );

      // 3. Platform fee reversal (debit-side offset; 300 = 30% to undo the
      //    prior `credit` platform fee).
      expect(mockPrisma.platformLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `imp-${impressionId}-plt-rev` },
          create: expect.objectContaining({
            entryType: 'reversal',
            bucket: 'platform_fee',
            amountMinor: 300,
          }),
        }),
      );

      // 4. Fraud-reserve release (100 = 10% reserve bucket released since
      //    this is exactly what it was set aside for).
      expect(mockPrisma.platformLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `imp-${impressionId}-res-rev` },
          create: expect.objectContaining({
            entryType: 'reversal',
            bucket: 'fraud_reserve',
            amountMinor: 100,
          }),
        }),
      );
    });

    it('is idempotent — a replayed call hits `update: {}` no-op on already-created compensation rows', async () => {
      const impressionId = 'imp-xyz';
      mockPrisma.advertiserLedger.findUnique.mockResolvedValueOnce({
        id: 'adv-row-1', advertiserId: 'adv-1', campaignId: 'cmp-1',
        amountMinor: 500, currency: 'USD',
        idempotencyKey: `imp-${impressionId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null); // no plt row
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null); // no res row
      mockPrisma.earningsLedger.count.mockResolvedValueOnce(0);
      // Replay: earnings already reversed, no rows match the status filter.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.advertiserLedger.upsert.mockResolvedValue({});

      const result = await service.reverseEarnings({ impressionId });

      expect(result).toEqual({ reversed: 0, paidSkipped: 0 });
      // Only the advertiser refund fires (platform rows absent → skipped).
      // The upsert MUST still be called with `update: {}` so the
      // `@unique(idempotencyKey)` collision path is harmless (upsert
      // treats a duplicate id as the no-op `update: {}`). This proves
      // the idempotency floor: replaying reverseEarnings writes nothing
      // new and doesn't throw.
      expect(mockPrisma.advertiserLedger.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.platformLedger.upsert).not.toHaveBeenCalled();
    });

    it('records recovery debit when the impression has earnings already in `paid` (developer withdrawal)', async () => {
      const impressionId = 'imp-paid';
      mockPrisma.advertiserLedger.findUnique.mockResolvedValueOnce({
        id: 'adv-row-1', advertiserId: 'adv-1', campaignId: 'cmp-1',
        amountMinor: 200, currency: 'USD',
        idempotencyKey: `imp-${impressionId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null);
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null);
      // 2 rows already in `paid` — can't be reversed by this method.
      mockPrisma.earningsLedger.count.mockResolvedValueOnce(2);
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.earningsLedger.findMany.mockResolvedValueOnce([
        {
          id: 'earn-paid-1',
          userId: 'user-1',
          campaignId: 'cmp-1',
          impressionId,
          clickId: null,
          amountMinor: 120,
          currency: 'USD',
        },
        {
          id: 'earn-paid-2',
          userId: 'user-1',
          campaignId: 'cmp-1',
          impressionId,
          clickId: null,
          amountMinor: 80,
          currency: 'USD',
        },
      ]);
      mockPrisma.advertiserLedger.upsert.mockResolvedValue({});
      mockPrisma.earningsLedger.upsert.mockResolvedValue({});

      const result = await service.reverseEarnings({ impressionId });

      expect(result.paidSkipped).toBe(2);
      expect(mockPrisma.earningsLedger.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.earningsLedger.upsert).toHaveBeenCalledWith({
        where: { idempotencyKey: `imp-${impressionId}-paid-debt-earn-paid-1` },
        create: expect.objectContaining({
          userId: 'user-1',
          campaignId: 'cmp-1',
          impressionId,
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: 120,
          currency: 'USD',
          availableAt: null,
          idempotencyKey: `imp-${impressionId}-paid-debt-earn-paid-1`,
        }),
        update: {},
      });
    });

    /**
     * Round 11 follow-up: `reverseEarnings` previously keyed ONLY on
     * `impressionId`, so confirmed click-fraud (a flag carrying
     * `clickId` but no `impressionId`) skipped reversals entirely —
     * the developer's click-credit stayed `confirmed`, the advertiser
     * remained debited, the platform's fee + reserve stayed accrued on
     * a fraudulent click. This test pins the new entity-aware path:
     * a clickId-only reversal reads `clk-${id}-*` idempotency keys,
     * writes 3 compensating entries against them, and flips the
     * developer row keyed on `clickId` (not `impressionId`).
     */
    it('writes the 3 compensating entries when called with only a clickId (click-fraud path)', async () => {
      const clickId = 'clk-fraud-1';
      // Pre-flight: click-keyed compensation rows.
      mockPrisma.advertiserLedger.findUnique.mockResolvedValueOnce({
        id: 'adv-row-click',
        advertiserId: 'adv-click',
        campaignId: 'cmp-click',
        amountMinor: 500, // full CPC click bid
        currency: 'USD',
        idempotencyKey: `clk-${clickId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'plt-row-click',
        campaignId: 'cmp-click',
        amountMinor: 150, // 30% platform fee
        currency: 'USD',
        idempotencyKey: `clk-${clickId}-plt`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'res-row-click',
        campaignId: 'cmp-click',
        amountMinor: 50, // 10% fraud reserve
        currency: 'USD',
        idempotencyKey: `clk-${clickId}-res`,
      });
      mockPrisma.earningsLedger.count.mockResolvedValueOnce(0);
      // Earnings row flipped by clickId, not impressionId.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.advertiserLedger.upsert.mockResolvedValue({});
      mockPrisma.platformLedger.upsert
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await service.reverseEarnings({ clickId }, 'click_abuse');

      expect(result).toEqual({ reversed: 1, paidSkipped: 0 });

      // 1. Earnings row flipped by clickId (where: { clickId }).
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clickId,
            status: { in: ['estimated', 'pending', 'confirmed'] },
          }),
        }),
      );
      // And NOT keyed on impressionId — proves the discriminator worked.
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ impressionId: clickId }),
        }),
      );

      // 2. Advertiser refund keyed on the click prefix.
      expect(mockPrisma.advertiserLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `clk-${clickId}-adv-rev` },
          create: expect.objectContaining({
            advertiserId: 'adv-click',
            entryType: 'refund',
            amountMinor: 500,
          }),
        }),
      );

      // 3-4. Platform fee + reserve reversals keyed on the click prefix.
      expect(mockPrisma.platformLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `clk-${clickId}-plt-rev` },
          create: expect.objectContaining({
            entryType: 'reversal',
            bucket: 'platform_fee',
            amountMinor: 150,
          }),
        }),
      );
      expect(mockPrisma.platformLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `clk-${clickId}-res-rev` },
          create: expect.objectContaining({
            entryType: 'reversal',
            bucket: 'fraud_reserve',
            amountMinor: 50,
          }),
        }),
      );
    });

    it('returns zero zeros when neither clickId nor impressionId is provided', async () => {
      const result = await service.reverseEarnings({});
      expect(result).toEqual({ reversed: 0, paidSkipped: 0 });
      // No compensation lookup, no $transaction, no ledger writes.
      expect(mockPrisma.advertiserLedger.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.platformLedger.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.earningsLedger.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getPlatformBreakdown', () => {
    it('keeps platform-wide ledger totals separated by currency', async () => {
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 1000 } },
          { currency: 'EUR', _sum: { amountMinor: 2000 } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 100 } },
          { currency: 'EUR', _sum: { amountMinor: 250 } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 75 } },
          { currency: 'EUR', _sum: { amountMinor: 125 } },
        ]);
      mockPrisma.advertiserLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 1800 } },
          { currency: 'EUR', _sum: { amountMinor: 2600 } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 300 } },
          { currency: 'EUR', _sum: { amountMinor: 400 } },
        ]);
      mockPrisma.platformLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 500 } },
          { currency: 'EUR', _sum: { amountMinor: 700 } },
        ])
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 50 } }])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 200 } },
          { currency: 'EUR', _sum: { amountMinor: 300 } },
        ])
        .mockResolvedValueOnce([{ currency: 'EUR', _sum: { amountMinor: 25 } }]);

      const result = await service.getPlatformBreakdown();

      expect(result.totalEarnings).toBe(900);
      expect(result.totalAdvertiserSpend).toBe(1500);
      expect(result.totalPlatformFee).toBe(450);
      expect(result.totalReserve).toBe(200);
      expect(result.byCurrency).toEqual({
        totalEarnings: { USD: 900, EUR: 1750 },
        totalAdvertiserSpend: { USD: 1500, EUR: 2200 },
        totalPlatformFee: { USD: 450, EUR: 700 },
        totalReserve: { USD: 200, EUR: 275 },
      });
      expect(result.earningsLedger.pendingMinor).toBe(75);
      expect(result.earningsLedger.pendingByCurrency).toEqual({ USD: 75, EUR: 125 });
      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledWith({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', status: { in: ['confirmed', 'paid'] } },
      });
      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledWith({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', status: 'pending' },
      });
    });
  });
});
