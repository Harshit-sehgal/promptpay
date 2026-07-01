import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { REVENUE_SPLIT, LAUNCH_INCENTIVE_SPLIT, PAYOUT_HOLD_DAYS } from '@waitlayer/shared';
import { LedgerStatus } from '@waitlayer/shared';
import { Prisma } from '@waitlayer/db';

/** Valid earning state transitions */
const EARNING_TRANSITIONS: Record<string, LedgerStatus[]> = {
  estimated: ['pending', 'confirmed', 'held', 'reversed', 'void'] as LedgerStatus[],
  pending: ['confirmed', 'held', 'reversed', 'void'] as LedgerStatus[],
  confirmed: ['held', 'paid', 'reversed', 'void'] as LedgerStatus[],
  held: ['confirmed', 'reversed', 'void'] as LedgerStatus[],
  paid: [] as LedgerStatus[],
  reversed: [] as LedgerStatus[],
  void: [] as LedgerStatus[],
};

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  // ── Revenue Split ──

  /** Calculate revenue split with optional launch incentive */
  calculateSplit(bidAmountMinor: number, useLaunchIncentive = false) {
    const split = useLaunchIncentive ? LAUNCH_INCENTIVE_SPLIT : REVENUE_SPLIT;
    const userShare = Math.floor(bidAmountMinor * split.USER);
    const platformShare = Math.floor(bidAmountMinor * split.PLATFORM);
    const reserveShare = Math.floor(bidAmountMinor * split.RESERVE);
    // Remainder goes to user to avoid rounding loss
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
    const availableAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `imp-${impressionId}`;

    return this.prisma.$transaction([
      // Debit advertiser
      this.prisma.advertiserLedger.create({
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
      }),
      // Credit developer (estimated until matured)
      this.prisma.earningsLedger.create({
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
      }),
      // Credit platform fee
      this.prisma.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.platformShare,
          currency,
          bucket: 'platform_fee',
          referenceId: impressionId,
          idempotencyKey: `${idempotencyBase}-plt`,
          description: 'Platform fee from impression',
        },
      }),
      // Credit fraud/payment reserve
      this.prisma.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.reserveShare,
          currency,
          bucket: 'fraud_reserve',
          referenceId: impressionId,
          idempotencyKey: `${idempotencyBase}-res`,
          description: 'Fraud/payment reserve from impression',
        },
      }),
    ]);
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
    const availableAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `clk-${clickId}`;

    return this.prisma.$transaction([
      // Debit advertiser for click
      this.prisma.advertiserLedger.create({
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
      }),
      // Credit developer for click
      this.prisma.earningsLedger.create({
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
      }),
    ]);
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

  /** Transition a single earning entry to a new status (with validation) */
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

    return this.prisma.earningsLedger.update({
      where: { id: entryId },
      data: {
        status: newStatus,
        description: reason
          ? `${entry.description || ''} [${newStatus}: ${reason}]`
          : undefined,
      },
    });
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

  /** Release held earnings for a user (after fraud review clears) */
  async releaseEarnings(userId: string) {
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
    if (filters?.ledgerKind === 'earnings') {
      // already constrained to earningsLedger below
    }

    if (filters?.ledgerKind === 'platform' || filters?.ledgerKind === 'advertiser') {
      // Admins get all ledgers via getHistoryForAdmin
      return this.getHistoryForAdmin(filters, page, limit);
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
      this.prisma.earningsLedger.aggregate({ _sum: { amountMinor: true } }),
      this.prisma.advertiserLedger.aggregate({ _sum: { amountMinor: true }, where: { entryType: 'debit' } }),
      this.prisma.platformLedger.aggregate({ _sum: { amountMinor: true }, where: { entryType: 'credit' } }),
      this.prisma.platformLedger.aggregate({ _sum: { amountMinor: true }, where: { entryType: 'credit', bucket: 'reserve' } }),
    ]);

    return {
      totalEarnings: totalEarnings._sum?.amountMinor ?? 0,
      totalAdvertiserSpend: totalAdvertiserSpend._sum?.amountMinor ?? 0,
      totalPlatformFee: totalPlatformFee._sum?.amountMinor ?? 0,
      totalReserve: totalReserve._sum?.amountMinor ?? 0,
    };
  }
}
