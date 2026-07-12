import { BadRequestException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { LedgerStatus, primaryCurrency } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import { LedgerMathTrait } from './ledger-math.trait';

export class LedgerBalanceTrait {
  declare prisma: PrismaService;

  // ── Balance Queries ──
  /** Get total confirmed (available) earnings for a user */
  async getAvailableBalance(userId: string): Promise<{
    amountMinor: bigint;
    currency: string;
    byCurrency: Record<string, bigint>;
  }> {
    const [credits, debits] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const totals: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(totals, credits);
    this.addGroupedCurrencyTotals(totals, debits, -1n);
    const byCurrency = this.nonNegativeCurrencyTotals(totals);
    // Derive the primary currency from the user's ACTUAL balance
    // (largest positive), not a hardcoded 'USD'. Fixes the
    // multi-currency bug where a developer with only EUR
    // earnings saw `amountMinor: 0, currency: 'USD'`.
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0n,
      currency,
      byCurrency,
    };
  }

  /** Get total pending (estimated + confirmed) earnings for a user */
  async getPendingBalance(userId: string): Promise<{
    amountMinor: bigint;
    currency: string;
    byCurrency: Record<string, bigint>;
  }> {
    const result = await this.prisma.earningsLedger.groupBy({
      by: ['currency'],
      where: { userId, status: { in: ['estimated', 'pending'] }, entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    const byCurrency: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(byCurrency, result);
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0n,
      currency,
      byCurrency,
    };
  }

  /** Get all-time total earnings for a user (excluding reversed/void) */
  async getTotalEarnings(userId: string): Promise<{
    amountMinor: bigint;
    currency: string;
    byCurrency: Record<string, bigint>;
  }> {
    const [credits, debits] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: { notIn: ['reversed', 'void'] }, entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: { notIn: ['reversed', 'void'] }, entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const totals: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(totals, credits);
    this.addGroupedCurrencyTotals(totals, debits, -1n);
    const byCurrency = this.nonNegativeCurrencyTotals(totals);
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0n,
      currency,
      byCurrency,
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
      amountMinor: g._sum.amountMinor || 0n,
      count: g._count,
    }));
  }

  /** Get paid-out total for a user */
  async getPaidOutTotal(userId: string): Promise<{
    amountMinor: bigint;
    currency: string;
    byCurrency: Record<string, bigint>;
  }> {
    const result = await this.prisma.earningsLedger.groupBy({
      by: ['currency'],
      where: { userId, status: 'paid', entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    const byCurrency: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(byCurrency, result);
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0n,
      currency,
      byCurrency,
    };
  }

  /** Get earnings history with pagination */
  async getEarningsHistory(
    userId: string,
    page = 1,
    limit = 20,
    filters?: {
      ledgerKind?: string;
      status?: string;
    },
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
}
export interface LedgerBalanceTrait extends LedgerMathTrait {}
