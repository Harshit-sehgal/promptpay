import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  $executeRaw: vi.fn(async (..._args: unknown[]) => undefined),
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

// reverseEarnings emits a fire-and-forget `void this.audit.log(...)` after the
// $transaction. The real AuditService queues/buffers on failure; in these
// unit tests we only need the call to not throw and not block. `log` resolves
// undefined so any accidental `await` of the voided promise still behaves.
const mockAudit = {
  log: vi.fn().mockResolvedValue(undefined),
  logStrict: vi.fn().mockResolvedValue(undefined),
} as any;

describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LedgerService(prismaRef, mockAudit);
  });

  describe('calculateSplit', () => {
    it('splits 60/30/10 by default', () => {
      const result = service.calculateSplit(1000n, false);
      expect(result.userShare + result.platformShare + result.reserveShare).toBe(1000n);
      expect(result.userShare).toBe(600n);
      expect(result.platformShare).toBe(300n);
      expect(result.reserveShare).toBe(100n);
    });

    it('splits 80/10/10 when incentivized', () => {
      const result = service.calculateSplit(1000n, true);
      expect(result.userShare).toBe(800n);
      expect(result.platformShare).toBe(100n);
      expect(result.reserveShare).toBe(100n);
    });

    it('handles indivisible amounts correctly', () => {
      const result = service.calculateSplit(100n, false);
      // 100 cents: user=60, platform=30, reserve=10
      expect(result.userShare + result.platformShare + result.reserveShare).toBe(100n);
    });
  });

  describe('releaseEarnings', () => {
    it('releases every row stamped by the resolved flag and leaves other flags held', async () => {
      const rows = [
        { id: 'earn-1', userId: 'u-1', impressionId: 'imp-1', status: 'held', heldByFlagId: 'F1' },
        { id: 'earn-2', userId: 'u-1', impressionId: 'imp-2', status: 'held', heldByFlagId: 'F1' },
        { id: 'earn-3', userId: 'u-1', impressionId: 'imp-1', status: 'held', heldByFlagId: 'F2' },
      ];
      mockPrisma.earningsLedger.updateMany.mockImplementation(async ({ where, data }) => {
        let count = 0;
        for (const row of rows) {
          if (
            row.userId === where.userId &&
            row.status === where.status &&
            row.heldByFlagId === where.heldByFlagId
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      });

      await service.releaseEarnings('u-1', { impressionId: 'imp-1', flagId: 'F1' });

      expect(rows).toEqual([
        expect.objectContaining({ id: 'earn-1', status: 'confirmed', heldByFlagId: null }),
        expect.objectContaining({ id: 'earn-2', status: 'confirmed', heldByFlagId: null }),
        expect.objectContaining({ id: 'earn-3', status: 'held', heldByFlagId: 'F2' }),
      ]);
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', heldByFlagId: 'F1', status: 'held' },
        data: { status: 'confirmed', heldByFlagId: null },
      });
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
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 250_00n } }])
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 40_00n } }]);

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(210_00n);
      expect(result.currency).toBe('USD');
      expect(result.byCurrency).toEqual({ USD: 210_00n });
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
      mockPrisma.earningsLedger.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(0n);
      expect(result.currency).toBe('USD');
      expect(result.byCurrency).toEqual({});
      expect(mockPrisma.payoutRequest.aggregate).not.toHaveBeenCalled();
    });

    it('keeps confirmed balances separated by currency', async () => {
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 250_00n } },
          { currency: 'EUR', _sum: { amountMinor: 100_00n } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 40_00n } },
          { currency: 'EUR', _sum: { amountMinor: 10_00n } },
        ]);

      const result = await service.getAvailableBalance('u-1');

      expect(result.amountMinor).toBe(210_00n);
      expect(result.byCurrency).toEqual({ USD: 210_00n, EUR: 90_00n });
    });
  });

  describe('getPendingBalance', () => {
    it('returns sum of pending and estimated earnings', async () => {
      mockPrisma.earningsLedger.groupBy.mockResolvedValue([
        { currency: 'USD', _sum: { amountMinor: 50_00n } },
      ]);

      const result = await service.getPendingBalance('u-1');
      expect(result.amountMinor).toBe(50_00n);
      expect(result.byCurrency).toEqual({ USD: 50_00n });
    });
  });

  describe('getEarningsHistory', () => {
    it('paginates entries', async () => {
      mockPrisma.earningsLedger.findMany.mockResolvedValue([
        { id: 'e-1', userId: 'u-1', amountMinor: 10n, status: 'confirmed', createdAt: new Date() },
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
        budgetTotalMinor: 1000_00n,
      });

      await service.recordImpressionEarnings({
        userId: 'u-1',
        campaignId: 'c-1',
        impressionId: 'imp-1',
        bidAmountMinor: 2_00n,
        currency: 'USD',
        advertiserId: 'a-1',
        trustLevel: 'normal',
      });

      // $transaction was invoked
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      const impressionSql = mockPrisma.$executeRaw.mock.calls[0][0]?.strings?.join(' ') ?? '';
      expect(impressionSql).toContain('UPDATE "campaigns"');
      expect(mockPrisma.advertiserLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          advertiserId: 'a-1',
          campaignId: 'c-1',
          entryType: 'debit',
          amountMinor: 2_00n,
        }),
      });
      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-1',
          campaignId: 'c-1',
          impressionId: 'imp-1',
          amountMinor: 120n,
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'platform_fee',
          amountMinor: 60n,
          referenceId: 'imp-1',
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'fraud_reserve',
          amountMinor: 20n,
          referenceId: 'imp-1',
        }),
      });
    });

    it('sets hold days based on trust level', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: 'c-1',
        budgetSpentMinor: 0,
        budgetTotalMinor: 1000_00n,
      });

      await service.recordImpressionEarnings({
        userId: 'u-1',
        campaignId: 'c-1',
        impressionId: 'imp-2',
        bidAmountMinor: 2_00n,
        currency: 'USD',
        advertiserId: 'a-1',
        trustLevel: 'high_trust',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('creates no impression ledger entries when campaign budget is exhausted', async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      await expect(
        service.recordImpressionEarnings({
          userId: 'u-1',
          campaignId: 'c-1',
          impressionId: 'imp-3',
          bidAmountMinor: 2_00n,
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
        clickBidMinor: 5_00n,
        currency: 'USD',
        advertiserId: 'a-1',
        trustLevel: 'normal',
      });

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      const clickSql = mockPrisma.$executeRaw.mock.calls[0][0]?.strings?.join(' ') ?? '';
      expect(clickSql).toContain('UPDATE "campaigns"');
      expect(mockPrisma.advertiserLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          advertiserId: 'a-1',
          campaignId: 'c-1',
          entryType: 'debit',
          amountMinor: 5_00n,
        }),
      });
      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-1',
          campaignId: 'c-1',
          clickId: 'clk-1',
          amountMinor: 300n,
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'platform_fee',
          amountMinor: 150n,
          referenceId: 'clk-1',
        }),
      });
      expect(mockPrisma.platformLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bucket: 'fraud_reserve',
          amountMinor: 50n,
          referenceId: 'clk-1',
        }),
      });
    });

    it('creates no CPC click ledger entries when campaign budget is exhausted', async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      await expect(
        service.recordClickEarnings({
          userId: 'u-1',
          campaignId: 'c-1',
          clickId: 'clk-2',
          clickBidMinor: 5_00n,
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

      await expect((service as any).transitionEarning('e-1', 'confirmed' as any)).rejects.toThrow();
    });

    it('allows valid transitions', async () => {
      // The read returns the current status; the CAS updateMany wins
      // (count: 1) and the post-update re-read returns the new status.
      mockPrisma.earningsLedger.findUnique
        .mockResolvedValueOnce({
          // transitionEarning's initial read
          id: 'e-2',
          userId: 'u-1',
          status: 'confirmed',
          amountMinor: 100n,
          currency: 'USD',
        })
        .mockResolvedValueOnce({
          // re-read after the winning CAS write
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
        amountMinor: 100n,
        currency: 'USD',
      });
      // count: 0 → the row's status changed between read and write.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 0 });

      await expect((service as any).transitionEarning('e-3', 'held' as any)).rejects.toThrow(
        /modified by a concurrent transition/,
      );
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
    it('writes the three compensating entries (advertiser credit + 2 platform reversals)', async () => {
      const impressionId = 'imp-abc';
      // Pre-flight: read the impression's advertisement debit + platform rows
      mockPrisma.advertiserLedger.findUnique.mockResolvedValueOnce({
        id: 'adv-row-1',
        advertiserId: 'adv-1',
        campaignId: 'cmp-1',
        amountMinor: 1000n, // full bid
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'plt-row-1',
        campaignId: 'cmp-1',
        amountMinor: 300n, // platform fee (30%)
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-plt`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'res-row-1',
        campaignId: 'cmp-1',
        amountMinor: 100n, // fraud reserve (10%)
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-res`,
      });
      mockPrisma.earningsLedger.findMany.mockResolvedValueOnce([]);
      // Inside the transaction: 1 earnings row flipped.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 1 });
      // All three upserts are new (no prior replay).
      mockPrisma.advertiserLedger.upsert.mockResolvedValue({});
      mockPrisma.platformLedger.upsert
        .mockResolvedValueOnce({}) // plt reversal
        .mockResolvedValueOnce({}); // res reversal

      const result = await service.reverseEarnings({ impressionId }, 'click_abuse');

      expect(result).toEqual({ reversed: 1, paidSkipped: 0 });

      // 0. Audit row emitted once with a system actor — reverseEarnings is a
      //    service-layer-only path the controller AuditInterceptor cannot see,
      //    so the audit.log call must fire here. beforeSnap carries the
      //    reversed/paidSkipped counts + reason for the audit timeline.
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockAudit.log).toHaveBeenCalledWith({
        actorId: 'ledger_service',
        actorRole: 'system',
        action: 'reverse_earnings',
        targetType: 'impression',
        targetId: impressionId,
        beforeSnap: { reversed: 1, paidSkipped: 0, reason: 'click_abuse' },
      });

      // 1. Earnings row flipped to `reversed` with the reason in description.
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: {
          impressionId,
          status: { in: ['estimated', 'pending', 'confirmed', 'held'] },
        },
        data: expect.objectContaining({
          status: 'reversed',
          heldByFlagId: null,
          description: 'Reversed: click_abuse',
        }),
      });

      // 2. Advertiser compensating credit with the FULL bid (advertiser must
      //    not pay for fraud) under the `-rev` idempotency suffix.
      expect(mockPrisma.advertiserLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `imp-${impressionId}-adv-rev` },
          create: expect.objectContaining({
            advertiserId: 'adv-1',
            campaignId: 'cmp-1',
            entryType: 'credit',
            status: 'confirmed',
            amountMinor: 1000n,
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
            amountMinor: 300n,
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
            amountMinor: 100n,
          }),
        }),
      );
    });

    it('is idempotent — a replayed call hits `update: {}` no-op on already-created compensation rows', async () => {
      const impressionId = 'imp-xyz';
      mockPrisma.advertiserLedger.findUnique.mockResolvedValueOnce({
        id: 'adv-row-1',
        advertiserId: 'adv-1',
        campaignId: 'cmp-1',
        amountMinor: 500n,
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null); // no plt row
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null); // no res row
      mockPrisma.earningsLedger.findMany.mockResolvedValueOnce([]);
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
        id: 'adv-row-1',
        advertiserId: 'adv-1',
        campaignId: 'cmp-1',
        amountMinor: 200n,
        currency: 'USD',
        idempotencyKey: `imp-${impressionId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null);
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce(null);
      // 2 rows already in `paid` — can't be reversed by this method. The
      // service discovers them inside the same transaction as the reversal.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.earningsLedger.findMany.mockResolvedValueOnce([
        {
          id: 'earn-paid-1',
          userId: 'user-1',
          campaignId: 'cmp-1',
          impressionId,
          clickId: null,
          amountMinor: 120n,
          currency: 'USD',
        },
        {
          id: 'earn-paid-2',
          userId: 'user-1',
          campaignId: 'cmp-1',
          impressionId,
          clickId: null,
          amountMinor: 80n,
          currency: 'USD',
        },
      ]);
      mockPrisma.advertiserLedger.upsert.mockResolvedValue({});
      mockPrisma.earningsLedger.upsert.mockResolvedValue({});

      const result = await service.reverseEarnings({ impressionId });

      expect(result.paidSkipped).toBe(2);
      expect(mockPrisma.earningsLedger.count).not.toHaveBeenCalled();
      expect(mockPrisma.earningsLedger.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.earningsLedger.upsert).toHaveBeenCalledWith({
        where: { idempotencyKey: `imp-${impressionId}-paid-debt-earn-paid-1` },
        create: expect.objectContaining({
          userId: 'user-1',
          campaignId: 'cmp-1',
          impressionId,
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: 120n,
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
        amountMinor: 500n, // full CPC click bid
        currency: 'USD',
        idempotencyKey: `clk-${clickId}-adv`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'plt-row-click',
        campaignId: 'cmp-click',
        amountMinor: 150n, // 30% platform fee
        currency: 'USD',
        idempotencyKey: `clk-${clickId}-plt`,
      });
      mockPrisma.platformLedger.findUnique.mockResolvedValueOnce({
        id: 'res-row-click',
        campaignId: 'cmp-click',
        amountMinor: 50n, // 10% fraud reserve
        currency: 'USD',
        idempotencyKey: `clk-${clickId}-res`,
      });
      mockPrisma.earningsLedger.findMany.mockResolvedValueOnce([]);
      // Earnings row flipped by clickId, not impressionId.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.advertiserLedger.upsert.mockResolvedValue({});
      mockPrisma.platformLedger.upsert.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const result = await service.reverseEarnings({ clickId }, 'click_abuse');

      expect(result).toEqual({ reversed: 1, paidSkipped: 0 });

      // 0. Audit row emits targetType:'click' (not 'impression') — pins the
      //    click-vs-impression discriminator in the audit timeline.
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'reverse_earnings',
          targetType: 'click',
          targetId: clickId,
        }),
      );

      // 1. Earnings row flipped by clickId (where: { clickId }).
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clickId,
            status: { in: ['estimated', 'pending', 'confirmed', 'held'] },
          }),
        }),
      );
      // And NOT keyed on impressionId — proves the discriminator worked.
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ impressionId: clickId }),
        }),
      );

      // 2. Advertiser compensating credit keyed on the click prefix.
      expect(mockPrisma.advertiserLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `clk-${clickId}-adv-rev` },
          create: expect.objectContaining({
            advertiserId: 'adv-click',
            entryType: 'credit',
            amountMinor: 500n,
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
            amountMinor: 150n,
          }),
        }),
      );
      expect(mockPrisma.platformLedger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: `clk-${clickId}-res-rev` },
          create: expect.objectContaining({
            entryType: 'reversal',
            bucket: 'fraud_reserve',
            amountMinor: 50n,
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
      // No audit row either — nothing moved, so there is nothing to record.
      expect(mockAudit.log).not.toHaveBeenCalled();
    });
  });

  describe('getPlatformBreakdown', () => {
    it('keeps platform-wide ledger totals separated by currency', async () => {
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 1000n } },
          { currency: 'EUR', _sum: { amountMinor: 2000n } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 100n } },
          { currency: 'EUR', _sum: { amountMinor: 250n } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 75n } },
          { currency: 'EUR', _sum: { amountMinor: 125n } },
        ]);
      mockPrisma.advertiserLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 1800n } },
          { currency: 'EUR', _sum: { amountMinor: 2600n } },
        ])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 300n } },
          { currency: 'EUR', _sum: { amountMinor: 400n } },
        ]);
      mockPrisma.platformLedger.groupBy
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 500n } },
          { currency: 'EUR', _sum: { amountMinor: 700n } },
        ])
        .mockResolvedValueOnce([{ currency: 'USD', _sum: { amountMinor: 50n } }])
        .mockResolvedValueOnce([
          { currency: 'USD', _sum: { amountMinor: 200n } },
          { currency: 'EUR', _sum: { amountMinor: 300n } },
        ])
        .mockResolvedValueOnce([{ currency: 'EUR', _sum: { amountMinor: 25n } }]);

      const result = await service.getPlatformBreakdown();

      // Top-level scalars derive from the primary (largest-positive) currency of
      // each byCurrency map — consistent with getAvailableBalance /
      // getPayoutInfo. In this fixture EUR is largest in every map, so each
      // scalar is the EUR total (NOT the USD total). The byCurrency maps below
      // still carry the full per-currency breakdown.
      expect(result.totalEarnings).toBe(1750n); // EUR = 2000 − 250 (debit)
      expect(result.totalAdvertiserSpend).toBe(2200n); // EUR = 2600 − 400 (refund)
      expect(result.totalPlatformFee).toBe(700n); // EUR = 700 (no EUR reversal)
      expect(result.totalReserve).toBe(275n); // EUR = 300 − 25 (reversal)
      expect(result.byCurrency).toEqual({
        totalEarnings: { USD: 900n, EUR: 1750n },
        totalAdvertiserSpend: { USD: 1500n, EUR: 2200n },
        totalPlatformFee: { USD: 450n, EUR: 700n },
        totalReserve: { USD: 200n, EUR: 275n },
      });
      expect(result.earningsLedger.pendingMinor).toBe(125n); // EUR = 125
      expect(result.earningsLedger.pendingByCurrency).toEqual({ USD: 75n, EUR: 125n });
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
