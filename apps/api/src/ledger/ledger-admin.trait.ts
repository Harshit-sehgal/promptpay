import { LedgerStatus, primaryCurrency } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import { PLATFORM_BUCKETS } from './ledger.constants';
import { LedgerMathTrait } from './ledger-math.trait';

export class LedgerAdminTrait {
  declare prisma: PrismaService;

  async getHistoryForAdmin(
    filters:
      | {
          ledgerKind?: string;
          status?: string;
        }
      | undefined,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const statusFilter = filters?.status ? { status: filters.status as LedgerStatus } : {};
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
      totalAdvertiserDebit,
      totalAdvertiserRefund,
      totalPlatformCredit,
      totalPlatformReversal,
      totalReserveCredit,
      totalReserveReversal,
      totalEarningsDebit,
      pendingEarnings,
    ] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', status: { in: ['confirmed', 'paid'] } },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit' },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'refund' },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.PLATFORM_FEE },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'reversal', bucket: PLATFORM_BUCKETS.PLATFORM_FEE },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.FRAUD_RESERVE },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'reversal', bucket: PLATFORM_BUCKETS.FRAUD_RESERVE },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit' },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', status: 'pending' },
      }),
    ]);
    const earningsByCurrency: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(earningsByCurrency, totalEarnings);
    this.addGroupedCurrencyTotals(earningsByCurrency, totalEarningsDebit, -1n);
    // Advertiser spend = gross debits (billed) minus refunds (reversed fraud, archive)
    const advertiserByCurrency: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(advertiserByCurrency, totalAdvertiserDebit);
    this.addGroupedCurrencyTotals(advertiserByCurrency, totalAdvertiserRefund, -1n);
    // Platform fees = gross credits (billed) minus reversals (reversed fraud)
    const platformByCurrency: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(platformByCurrency, totalPlatformCredit);
    this.addGroupedCurrencyTotals(platformByCurrency, totalPlatformReversal, -1n);
    // Fraud reserve = gross credits minus reversals (released on false-positive)
    const reserveByCurrency: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(reserveByCurrency, totalReserveCredit);
    this.addGroupedCurrencyTotals(reserveByCurrency, totalReserveReversal, -1n);
    const pendingByCurrency: Record<string, bigint> = {};
    this.addGroupedCurrencyTotals(pendingByCurrency, pendingEarnings);
    // Derive each top-level scalar from the primary (largest-positive)
    // currency of its byCurrency map — consistent with getAvailableBalance /
    // getPayoutInfo / getAvailableForPayout. The previous `… .USD ?? 0`
    // silently zeroed every non-USD currency when the breakdown was rendered
    // as a single scalar (the admin ledger page also defensively falls back
    // to `{ USD: scalar }`, so the scalar is kept as a primary-currency value
    // rather than removed). Full multi-currency data lives on the byCurrency
    // maps below.
    const earningsMinor = earningsByCurrency[primaryCurrency(earningsByCurrency)] ?? 0n;
    const pendingMinor = pendingByCurrency[primaryCurrency(pendingByCurrency)] ?? 0n;
    const advertiserMinor = advertiserByCurrency[primaryCurrency(advertiserByCurrency)] ?? 0n;
    const platformMinor = platformByCurrency[primaryCurrency(platformByCurrency)] ?? 0n;
    const reserveMinor = reserveByCurrency[primaryCurrency(reserveByCurrency)] ?? 0n;
    return {
      totalEarnings: earningsMinor,
      totalAdvertiserSpend: advertiserMinor,
      totalPlatformFee: platformMinor,
      totalReserve: reserveMinor,
      byCurrency: {
        totalEarnings: earningsByCurrency,
        totalAdvertiserSpend: advertiserByCurrency,
        totalPlatformFee: platformByCurrency,
        totalReserve: reserveByCurrency,
      },
      // Nested structures for frontend page UI compatibility
      earningsLedger: {
        balanceMinor: earningsMinor,
        pendingMinor,
        confirmedMinor: earningsMinor,
        byCurrency: earningsByCurrency,
        pendingByCurrency,
      },
      advertiserLedger: {
        balanceMinor: advertiserMinor,
        byCurrency: advertiserByCurrency,
      },
      platformLedger: {
        revenueMinor: platformMinor,
        reserveMinor: reserveMinor,
        revenueByCurrency: platformByCurrency,
        reserveByCurrency,
      },
    };
  }
}
export interface LedgerAdminTrait extends LedgerMathTrait {}
