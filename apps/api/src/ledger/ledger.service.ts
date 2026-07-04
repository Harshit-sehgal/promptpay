import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { REVENUE_SPLIT, LAUNCH_INCENTIVE_SPLIT, PAYOUT_HOLD_DAYS } from '@waitlayer/shared';
import { PLATFORM_BUCKETS } from './ledger.constants';
import { LedgerStatus } from '@waitlayer/shared';
import { Prisma } from '@waitlayer/db';

/** Valid earning state transitions */
const EARNING_TRANSITIONS: Partial<Record<LedgerStatus, LedgerStatus[]>> = {
  [LedgerStatus.ESTIMATED]: [LedgerStatus.PENDING, LedgerStatus.CONFIRMED, LedgerStatus.HELD, LedgerStatus.REVERSED, LedgerStatus.VOID],
  [LedgerStatus.PENDING]: [LedgerStatus.CONFIRMED, LedgerStatus.HELD, LedgerStatus.REVERSED, LedgerStatus.VOID],
  [LedgerStatus.CONFIRMED]: [LedgerStatus.HELD, LedgerStatus.PAID, LedgerStatus.REVERSED, LedgerStatus.VOID],
  [LedgerStatus.HELD]: [LedgerStatus.CONFIRMED, LedgerStatus.REVERSED, LedgerStatus.VOID],
  [LedgerStatus.PAID]: [],
  [LedgerStatus.REVERSED]: [],
  [LedgerStatus.VOID]: [],
};

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  // ── Revenue Split ──

  /**
   * Calculate revenue split with optional launch incentive.
   *
   * Money is integer minor units; floating-point multiplication + Math.floor on
   * the cents yields platform/reserve shares that can be off-by-one relative to
   * the intended basis-point split (e.g. `0.3 * 101 = 30.2999...`). The remainder
   * was previously dumped into userShare, which silently funnelled rounding loss
   * to/from platform and reserve. We compute in integer basis points instead.
   */
  calculateSplit(bidAmountMinor: number, useLaunchIncentive = false) {
    // Split percentages expressed as basis points (1 bps = 0.01%). Sum to 10000
    // (100.00%) for both REVENUE_SPLIT and LAUNCH_INCENTIVE_SPLIT at the source —
    // no float round-trip through the constants.
    const USER_BPS = 6000;
    const PLATFORM_BPS = 3000;
    const RESERVE_BPS = 1000;
    const LAUNCH_USER_BPS = 8000;
    const LAUNCH_PLATFORM_BPS = 1000;
    const LAUNCH_RESERVE_BPS = 1000;

    const userBps = useLaunchIncentive ? LAUNCH_USER_BPS : USER_BPS;
    const platformBps = useLaunchIncentive ? LAUNCH_PLATFORM_BPS : PLATFORM_BPS;
    const reserveBps = useLaunchIncentive ? LAUNCH_RESERVE_BPS : RESERVE_BPS;

    // Integer partition: largest-share-first convention absorbs any rounding
    // remainder deterministically. With bidAmountMinor * any_bps deterministic
    // and 10000 dividing bidAmountMinor * 10000 exactly, only off-by-one from
    // floor() across the three shares can occur; we route it to user (largest)
    // so platform/reserve never get under-credited.
    const userShare = Math.floor((bidAmountMinor * userBps) / 10000);
    const platformShare = Math.floor((bidAmountMinor * platformBps) / 10000);
    const reserveShare = Math.floor((bidAmountMinor * reserveBps) / 10000);
    const remainder = bidAmountMinor - userShare - platformShare - reserveShare;
    return {
      userShare: userShare + remainder,
      platformShare,
      reserveShare,
    };
  }

  /** Get hold days based on trust level */
  getHoldDays(trustLevel: string): number {
    switch (trustLevel) {
      case 'high_trust': return PAYOUT_HOLD_DAYS.HIGH_TRUST;
      case 'normal': return PAYOUT_HOLD_DAYS.NORMAL;
      case 'new':
      case 'low_trust':
        return PAYOUT_HOLD_DAYS.NEW_ACCOUNT;
      // `RESTRICTED = -1` and `BANNED = -1` are the contract for "indefinite
      // hold — never mature". Falling through to the default here would
      // silently give restricted/banned users a 30-day hold, defeating the
      // policy. Keep the explicit cases.
      case 'restricted':
      case 'banned':
        return PAYOUT_HOLD_DAYS.RESTRICTED;
      default:
        return PAYOUT_HOLD_DAYS.NEW_ACCOUNT;
    }
  }

  // ── Recording Earnings ──

  /** Record impression earnings across all three ledgers atomically */
  async recordImpressionEarnings(params: {
    userId: string;
    campaignId: string;
    impressionId: string;
    bidAmountMinor: number;
    currency: string;
    advertiserId: string;
    trustLevel: string;
  }) {
    const {
      userId,
      campaignId,
      impressionId,
      bidAmountMinor,
      currency,
      advertiserId,
      trustLevel,
    } = params;

    const split = this.calculateSplit(bidAmountMinor);
    const holdDays = this.getHoldDays(trustLevel);
    // A negative hold-day (PAYOUT_HOLD_DAYS.RESTRICTED = -1) means "indefinite hold,
    // never mature". Storing availableAt:null keeps matureEarnings()'s `<= new Date()`
    // filter from ever advancing the row. New Date() with a negative offset would
    // land in the past and falsely match.
    const availableAt = holdDays < 0 ? null : new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `imp-${impressionId}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const spent: number = await tx.$executeRawUnsafe(
        `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor"`,
        bidAmountMinor,
        campaignId,
      );
      if (spent === 0) {
        throw new ConflictException('Campaign budget exhausted');
      }

      // Debit advertiser
      await tx.advertiserLedger.create({
        data: {
          advertiserId,
          campaignId,
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: bidAmountMinor,
          currency,
          idempotencyKey: `${idempotencyBase}-adv`,
          description: `Impression charge - campaign ${campaignId}`,
        },
      });
      // Credit developer (estimated until matured)
      await tx.earningsLedger.create({
        data: {
          userId,
          campaignId,
          impressionId,
          entryType: 'credit',
          status: 'estimated',
          amountMinor: split.userShare,
          currency,
          availableAt,
          idempotencyKey: `${idempotencyBase}-usr`,
          description: 'Earnings from qualified impression',
        },
      });
      // Credit platform fee
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.platformShare,
          currency,
          bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
          referenceId: impressionId,
          idempotencyKey: `${idempotencyBase}-plt`,
          description: 'Platform fee from impression',
        },
      });
      // Credit fraud/payment reserve
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.reserveShare,
          currency,
          bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
          referenceId: impressionId,
          idempotencyKey: `${idempotencyBase}-res`,
          description: 'Fraud/payment reserve from impression',
        },
      });

      return { billed: true, split };
    });
  }

  /** Record click earnings (on top of impression) */
  async recordClickEarnings(params: {
    userId: string;
    campaignId: string;
    clickId: string;
    clickBidMinor: number;
    currency: string;
    advertiserId: string;
    trustLevel: string;
  }) {
    const {
      userId,
      campaignId,
      clickId,
      clickBidMinor,
      currency,
      advertiserId,
      trustLevel,
    } = params;

    const split = this.calculateSplit(clickBidMinor);
    const holdDays = this.getHoldDays(trustLevel);
    // Negative hold-day => indefinite hold (restricted trust level). See rationale on
    // recordImpressionEarnings; same handling here.
    const availableAt = holdDays < 0 ? null : new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `clk-${clickId}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const spent: number = await tx.$executeRawUnsafe(
        `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor"`,
        clickBidMinor,
        campaignId,
      );
      if (spent === 0) {
        throw new ConflictException('Campaign budget exhausted');
      }

      // Debit advertiser for click
      await tx.advertiserLedger.create({
        data: {
          advertiserId,
          campaignId,
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: clickBidMinor,
          currency,
          idempotencyKey: `${idempotencyBase}-adv`,
          description: `Click charge - campaign ${campaignId}`,
        },
      });
      // Credit developer for click
      await tx.earningsLedger.create({
        data: {
          userId,
          campaignId,
          clickId,
          entryType: 'credit',
          status: 'estimated',
          amountMinor: split.userShare,
          currency,
          availableAt,
          idempotencyKey: `${idempotencyBase}-usr`,
          description: 'Earnings from ad click',
        },
      });
      // Credit platform fee
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.platformShare,
          currency,
          bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
          referenceId: clickId,
          idempotencyKey: `${idempotencyBase}-plt`,
          description: 'Platform fee from ad click',
        },
      });
      // Credit fraud/payment reserve
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.reserveShare,
          currency,
          bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
          referenceId: clickId,
          idempotencyKey: `${idempotencyBase}-res`,
          description: 'Fraud/payment reserve from ad click',
        },
      });

      return { billed: true, split };
    });
  }

  // ── State Transitions ──

  /** Mature estimated earnings to confirmed after hold period */
  async matureEarnings() {
    const updated = await this.prisma.earningsLedger.updateMany({
      where: {
        status: 'estimated',
        availableAt: { lte: new Date() },
      },
      data: { status: 'confirmed' },
    });
    return { matured: updated.count };
  }

  /** Transition a single earning entry to a new status (with validation).
   *
   *  Read-then-update is racy: two concurrent callers could both read an
   *  `estimated` row and both flip it to `held`, double-applying a hold.
   *  We validate the transition against the observed status (for a clear
   *  error message), then apply it with an atomic conditional UPDATE
   *  (`updateMany where id AND status === observedStatus`). If the row's
   *  status moved between the read and the write, count === 0 → the caller
   *  loses the race and we surface a ConflictException so it can retry. */
  async transitionEarning(entryId: string, newStatus: LedgerStatus, reason?: string) {
    const entry = await this.prisma.earningsLedger.findUnique({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException(`Earning entry ${entryId} not found`);

    const allowed = EARNING_TRANSITIONS[entry.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid transition: ${entry.status} → ${newStatus}. Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }

    const result = await this.prisma.earningsLedger.updateMany({
      where: { id: entryId, status: entry.status },
      data: {
        status: newStatus,
        description: reason
          ? `${entry.description || ''} [${newStatus}: ${reason}]`
          : undefined,
      },
    });
    if (result.count === 0) {
      // The row's status changed between our read and the conditional
      // write — a concurrent transition won. Surface as a conflict so the
      // caller re-reads and decides whether to retry or no-op.
      throw new ConflictException(
        `Earning entry ${entryId} was modified by a concurrent transition; retry`,
      );
    }
    return this.prisma.earningsLedger.findUnique({ where: { id: entryId } });
  }

  /** Hold all earnings for a user (e.g., during fraud investigation) */
  async holdEarnings(userId: string, reason?: string) {
    return this.prisma.earningsLedger.updateMany({
      where: {
        userId,
        status: { in: ['estimated', 'pending', 'confirmed'] },
      },
      data: {
        status: 'held',
        description: reason ? `Held: ${reason}` : undefined,
      },
    });
  }

  /** Release held earnings after a fraud-flag review clears.
   *
   *  Two scopes are supported:
   *  - Per-impression (preferred when the flag links to a specific
   *    impression): only held earnings tied to that impression are
   *    flipped to `confirmed`. This avoids leaking legitimate holds
   *    from concurrent unrelated flags.
   *  - Bulk user-level fallback: used when the flag has no impressionId
   *    (e.g. click-pattern fraud without a specific impression). All
   *    held entries for the user are released — the flag-clear applies
   *    to the user as a whole.
   *
   *  Either way the operation is idempotent (no-op when nothing matches).
   */
  async releaseEarnings(userId: string, opts?: { impressionId?: string }) {
    if (opts?.impressionId) {
      return this.prisma.earningsLedger.updateMany({
        where: { userId, impressionId: opts.impressionId, status: 'held' },
        data: { status: 'confirmed' },
      });
    }
    return this.prisma.earningsLedger.updateMany({
      where: { userId, status: 'held' },
      data: { status: 'confirmed' },
    });
  }

  /** Reverse earnings for a specific impression (fraud or user report) */
  async reverseEarnings(impressionId: string, reason?: string) {
    return this.prisma.earningsLedger.updateMany({
      where: {
        impressionId,
        status: { in: ['estimated', 'pending', 'confirmed'] },
      },
      data: {
        status: 'reversed',
        description: reason ? `Reversed: ${reason}` : undefined,
      },
    });
  }

  /** Mark earnings as paid after successful payout */
  async markAsPaid(entryIds: string[]) {
    return this.prisma.earningsLedger.updateMany({
      where: { id: { in: entryIds }, status: 'confirmed' },
      data: { status: 'paid' },
    });
  }

  // ── Balance Queries ──

  /** Get total confirmed (available) earnings for a user */
  async getAvailableBalance(userId: string): Promise<{ amountMinor: number; currency: string }> {
    const result = await this.prisma.earningsLedger.aggregate({
      where: { userId, status: 'confirmed', entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    return {
      amountMinor: result._sum.amountMinor || 0,
      currency: 'USD',
    };
  }

  /** Get total pending (estimated + confirmed) earnings for a user */
  async getPendingBalance(userId: string): Promise<{ amountMinor: number; currency: string }> {
    const result = await this.prisma.earningsLedger.aggregate({
      where: { userId, status: { in: ['estimated', 'pending'] }, entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    return {
      amountMinor: result._sum.amountMinor || 0,
      currency: 'USD',
    };
  }

  /** Get all-time total earnings for a user (excluding reversed/void) */
  async getTotalEarnings(userId: string): Promise<{ amountMinor: number; currency: string }> {
    const result = await this.prisma.earningsLedger.aggregate({
      where: { userId, status: { notIn: ['reversed', 'void'] }, entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    return {
      amountMinor: result._sum.amountMinor || 0,
      currency: 'USD',
    };
  }

  /** Get breakdown of earnings by status for a user */
  async getEarningsBreakdown(userId: string) {
    const grouped = await this.prisma.earningsLedger.groupBy({
      by: ['status'],
      where: { userId, entryType: 'credit' },
      _sum: { amountMinor: true },
      _count: true,
    });

    return grouped.map((g) => ({
      status: g.status,
      amountMinor: g._sum.amountMinor || 0,
      count: g._count,
    }));
  }

  /** Get paid-out total for a user */
  async getPaidOutTotal(userId: string): Promise<{ amountMinor: number; currency: string }> {
    const result = await this.prisma.earningsLedger.aggregate({
      where: { userId, status: 'paid', entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    return {
      amountMinor: result._sum.amountMinor || 0,
      currency: 'USD',
    };
  }

  /** Get earnings history with pagination */
  async getEarningsHistory(
    userId: string,
    page = 1,
    limit = 20,
    filters?: { ledgerKind?: string; status?: string },
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.EarningsLedgerWhereInput = { userId };
    if (filters?.status) where.status = filters.status as LedgerStatus;

    // This method is strictly for a user's own earnings history.
    // Admins should use getHistoryForAdmin directly.
    if (filters?.ledgerKind && filters.ledgerKind !== 'earnings') {
      throw new BadRequestException('Users can only query the earnings ledger.');
    }

    const [entries, total] = await Promise.all([
      this.prisma.earningsLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.earningsLedger.count({ where }),
    ]);

    return {
      entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getHistoryForAdmin(
    filters: { ledgerKind?: string; status?: string } | undefined,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const statusFilter = filters?.status
      ? { status: filters.status as LedgerStatus }
      : {};

    // Single-ledger views: paginate at the DB layer with a real total count.
    if (filters?.ledgerKind === 'platform') {
      const [rows, total] = await Promise.all([
        this.prisma.platformLedger.findMany({
          where: statusFilter,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.platformLedger.count({ where: statusFilter }),
      ]);
      return {
        entries: rows.map((x) => ({ ...x, ledgerKind: 'platform' as const })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    if (filters?.ledgerKind === 'advertiser') {
      const [rows, total] = await Promise.all([
        this.prisma.advertiserLedger.findMany({
          where: statusFilter,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.advertiserLedger.count({ where: statusFilter }),
      ]);
      return {
        entries: rows.map((x) => ({ ...x, ledgerKind: 'advertiser' as const })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    // Cross-ledger view: merge the top `skip + limit` rows from each table,
    // re-sort globally, then slice the requested page. Fetching `skip + limit`
    // (not just `limit`) keeps pagination correct beyond page 1, and the total
    // is the sum of per-table counts so totalPages is accurate.
    const take = skip + limit;
    const [e, a, p, ce, ca, cp] = await Promise.all([
      this.prisma.earningsLedger.findMany({
        where: statusFilter,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.advertiserLedger.findMany({
        where: statusFilter,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.platformLedger.findMany({
        where: statusFilter,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.earningsLedger.count({ where: statusFilter }),
      this.prisma.advertiserLedger.count({ where: statusFilter }),
      this.prisma.platformLedger.count({ where: statusFilter }),
    ]);
    const total = ce + ca + cp;
    const entries = [
      ...e.map((x) => ({ ...x, ledgerKind: 'earnings' as const })),
      ...a.map((x) => ({ ...x, ledgerKind: 'advertiser' as const })),
      ...p.map((x) => ({ ...x, ledgerKind: 'platform' as const })),
    ]
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .slice(skip, skip + limit);

    return { entries, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Platform-wide breakdown for admin dashboard */
  async getPlatformBreakdown() {
    const [
      totalEarnings,
      totalAdvertiserSpend,
      totalPlatformFee,
      totalReserve,
    ] = await Promise.all([
      this.prisma.earningsLedger.aggregate({ _sum: { amountMinor: true }, where: { entryType: 'credit' } }),
      this.prisma.advertiserLedger.aggregate({ _sum: { amountMinor: true }, where: { entryType: 'debit' } }),
      this.prisma.platformLedger.aggregate({ _sum: { amountMinor: true }, where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.PLATFORM_FEE } }),
      this.prisma.platformLedger.aggregate({ _sum: { amountMinor: true }, where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.FRAUD_RESERVE } }),
    ]);

    const earningsMinor = totalEarnings._sum?.amountMinor ?? 0;
    const advertiserMinor = totalAdvertiserSpend._sum?.amountMinor ?? 0;
    const platformMinor = totalPlatformFee._sum?.amountMinor ?? 0;
    const reserveMinor = totalReserve._sum?.amountMinor ?? 0;

    return {
      totalEarnings: earningsMinor,
      totalAdvertiserSpend: advertiserMinor,
      totalPlatformFee: platformMinor,
      totalReserve: reserveMinor,
      // Nested structures for frontend page UI compatibility
      earningsLedger: {
        balanceMinor: earningsMinor,
        pendingMinor: 0,
        confirmedMinor: earningsMinor,
      },
      advertiserLedger: {
        balanceMinor: advertiserMinor,
      },
      platformLedger: {
        revenueMinor: platformMinor,
        reserveMinor: reserveMinor,
      },
    };
  }
}
