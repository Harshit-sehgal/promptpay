import { isSupportedCurrency, primaryCurrency } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import { PLATFORM_BUCKETS } from '../ledger/ledger.constants';
import { netCurrencyAmounts } from './admin.constants';

export class AdminOverviewTrait {
  declare prisma: PrismaService;

  async getOverview() {
    const [users, campaigns, impressions, payouts, fraudFlags] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.campaign.count({ where: { status: 'active' } }),
      this.prisma.adImpression.count({ where: { isBillable: true } }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { status: 'paid', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.fraudFlag.count({ where: { status: 'open' } }),
    ]);
    const totalPayoutsByCurrency: Record<string, bigint> = Object.fromEntries(
      payouts.map((row) => [row.currency, BigInt(row._sum.amountMinor ?? 0)]),
    );
    return {
      activeUsers: users,
      activeCampaigns: campaigns,
      totalBillableImpressions: impressions,
      totalPayoutsMinor: totalPayoutsByCurrency[primaryCurrency(totalPayoutsByCurrency)] ?? 0n,
      totalPayoutsByCurrency,
      openFraudFlags: fraudFlags,
    };
  }

  async getMoneyIntegrityReport() {
    // 1. Campaign Spend vs Advertiser Debits
    const advertiserDebits = await this.prisma.advertiserLedger.groupBy({
      by: ['campaignId', 'currency'],
      where: { entryType: 'debit', status: { in: ['confirmed', 'paid'] } },
      _sum: { amountMinor: true },
    });
    const debitMap = new Map(
      advertiserDebits.map((d) => [`${d.campaignId}:${d.currency}`, d._sum.amountMinor ?? 0n]),
    );
    const debitCampaignIds = [
      ...new Set(
        advertiserDebits.map((d) => d.campaignId).filter((id): id is string => id !== null),
      ),
    ];
    // Bounded: only load campaigns that could be discrepant (recorded spend or a
    // matching ledger debit) instead of scanning the entire campaign table.
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        OR: [{ budgetSpentMinor: { not: 0 } }, { id: { in: debitCampaignIds } }],
      },
      select: { id: true, name: true, budgetSpentMinor: true, currency: true },
    });
    const campaignDiscrepancies: Array<{
      campaignId: string;
      campaignName: string;
      budgetSpentMinor: bigint;
      ledgerDebits: bigint;
      diff: bigint;
      currency: string;
    }> = [];
    for (const c of campaigns) {
      const debits = debitMap.get(`${c.id}:${c.currency}`) ?? 0n;
      if (c.budgetSpentMinor !== debits) {
        campaignDiscrepancies.push({
          campaignId: c.id,
          campaignName: c.name,
          budgetSpentMinor: c.budgetSpentMinor,
          ledgerDebits: debits,
          diff: c.budgetSpentMinor - debits,
          currency: c.currency,
        });
      }
    }
    // 2. Global Split Reconciliation
    const [
      totalEarningsCredit,
      totalEarningsDebit,
      totalAdvertiserDebit,
      totalAdvertiserRefund,
      totalAdvertiserCredit,
      totalAdvertiserReversal,
      totalPlatformCredit,
      totalPlatformReversal,
      totalReserveCredit,
      totalReserveReversal,
      totalCashCredit,
      totalCashReversal,
    ] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: {
          entryType: 'credit',
          status: { in: ['estimated', 'pending', 'confirmed', 'held', 'paid'] },
        },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit', status: 'confirmed' },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit', status: { in: ['confirmed', 'paid'] } },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'refund', status: { in: ['confirmed', 'paid'] } },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', status: 'confirmed' },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'reversal', status: { in: ['confirmed', 'reversed'] } },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.PLATFORM_FEE, status: 'confirmed' },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: {
          entryType: 'reversal',
          bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
          status: 'confirmed',
        },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.FRAUD_RESERVE, status: 'confirmed' },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: {
          entryType: 'reversal',
          bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
          status: 'confirmed',
        },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.CASH, status: 'confirmed' },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'reversal', bucket: PLATFORM_BUCKETS.CASH, status: 'confirmed' },
      }),
    ]);
    const netEarningsByCurrency = netCurrencyAmounts(totalEarningsCredit, totalEarningsDebit);
    const netAdvertiserByCurrency = netCurrencyAmounts(totalAdvertiserDebit, totalAdvertiserRefund);
    const netAdvertiserPositionByCurrency = netCurrencyAmounts(totalAdvertiserCredit, [
      ...totalAdvertiserDebit,
      ...totalAdvertiserRefund,
      ...totalAdvertiserReversal,
    ]);
    const netPlatformByCurrency = netCurrencyAmounts(totalPlatformCredit, totalPlatformReversal);
    const netReserveByCurrency = netCurrencyAmounts(totalReserveCredit, totalReserveReversal);
    const netCashByCurrency = netCurrencyAmounts(totalCashCredit, totalCashReversal);
    const currencies = new Set([
      ...Object.keys(netEarningsByCurrency),
      ...Object.keys(netAdvertiserByCurrency),
      ...Object.keys(netPlatformByCurrency),
      ...Object.keys(netReserveByCurrency),
      ...Object.keys(netCashByCurrency),
    ]);
    const globalReconciliationByCurrency = Object.fromEntries(
      Array.from(currencies)
        .sort()
        .map((currency) => {
          const netEarnings = netEarningsByCurrency[currency] ?? 0n;
          const netAdvertiser = netAdvertiserByCurrency[currency] ?? 0n;
          const netPlatform = netPlatformByCurrency[currency] ?? 0n;
          const netReserve = netReserveByCurrency[currency] ?? 0n;
          const netCash = netCashByCurrency[currency] ?? 0n;
          const netAdvertiserPosition = netAdvertiserPositionByCurrency[currency] ?? 0n;
          const splitSum = netEarnings + netPlatform + netReserve + netCash;
          return [
            currency,
            {
              netAdvertiserSpendMinor: netAdvertiser,
              netAdvertiserPositionMinor: netAdvertiserPosition,
              netDeveloperEarningsMinor: netEarnings,
              netPlatformFeeMinor: netPlatform,
              netReserveMinor: netReserve,
              netCashMinor: netCash,
              splitSumMinor: splitSum,
              discrepancyMinor: netAdvertiser - splitSum,
            },
          ];
        }),
    );
    const usdGlobal = globalReconciliationByCurrency.USD ?? {
      netAdvertiserSpendMinor: 0n,
      netAdvertiserPositionMinor: 0n,
      netDeveloperEarningsMinor: 0n,
      netPlatformFeeMinor: 0n,
      netReserveMinor: 0n,
      netCashMinor: 0n,
      splitSumMinor: 0n,
      discrepancyMinor: 0n,
    };
    const globalDiscrepancy = Object.values(globalReconciliationByCurrency).some(
      (row) => row.discrepancyMinor !== 0n,
    );
    // 3. Developer Negative Balances (bounded: aggregate earnings by
    //    user+currency, then fetch emails only for users with a negative balance
    //    instead of loading every developer row first).
    const [developerCreditGroups, developerDebitGroups] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const developerBalances = new Map<string, bigint>();
    for (const row of developerCreditGroups) {
      const key = `${row.userId}:${row.currency}`;
      developerBalances.set(
        key,
        (developerBalances.get(key) ?? 0n) + BigInt(row._sum.amountMinor ?? 0),
      );
    }
    for (const row of developerDebitGroups) {
      const key = `${row.userId}:${row.currency}`;
      developerBalances.set(
        key,
        (developerBalances.get(key) ?? 0n) - BigInt(row._sum.amountMinor ?? 0),
      );
    }
    const negativeDeveloperBalances: Array<{
      userId: string;
      email: string;
      balanceMinor: bigint;
      currency: string;
    }> = [];
    const negativeUserIds: string[] = [];
    for (const [key, balance] of developerBalances) {
      if (balance < 0n) {
        const [userId, currency] = key.split(':');
        negativeDeveloperBalances.push({ userId, email: userId, balanceMinor: balance, currency });
        negativeUserIds.push(userId);
      }
    }
    if (negativeUserIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: negativeUserIds } },
        select: { id: true, email: true },
      });
      const emailById = new Map(users.map((u) => [u.id, u.email]));
      for (const row of negativeDeveloperBalances) {
        row.email = emailById.get(row.userId) ?? row.userId;
      }
    }
    return {
      timestamp: new Date().toISOString(),
      status:
        campaignDiscrepancies.length === 0 &&
        !globalDiscrepancy &&
        negativeDeveloperBalances.length === 0
          ? 'healthy'
          : 'unhealthy',
      globalReconciliation: {
        netAdvertiserSpendMinor: usdGlobal.netAdvertiserSpendMinor,
        netDeveloperEarningsMinor: usdGlobal.netDeveloperEarningsMinor,
        netPlatformFeeMinor: usdGlobal.netPlatformFeeMinor,
        netReserveMinor: usdGlobal.netReserveMinor,
        netCashMinor: usdGlobal.netCashMinor,
        splitSumMinor: usdGlobal.splitSumMinor,
        discrepancyMinor: usdGlobal.discrepancyMinor,
      },
      globalReconciliationByCurrency,
      campaignDiscrepancies,
      negativeDeveloperBalances,
    };
  }

  // ── Operational Metrics ──
  async getMetrics(days = 30, currency = 'USD') {
    // A-007 / multi-currency fix: the platform is multi-currency
    // (A-081). Metrics were previously hard-filtered to USD, which
    // silently excluded ALL non-USD revenue/spend. The reporting
    // currency is now a parameter (default USD for backward
    // compatibility) so any currency is queryable and nothing is
    // dropped. Reject anything that is not a supported currency.
    const reportingCurrency = isSupportedCurrency(currency) ? currency.toUpperCase() : 'USD';
    const now = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prevPeriodStart = new Date(periodStart.getTime() - days * 24 * 60 * 60 * 1000);
    // Date-floor helper for grouping by day
    const floorDay = (d: Date): string => d.toISOString().slice(0, 10);
    // A-007: All daily aggregation is computed in the DATABASE via SQL
    // date_trunc instead of loading raw event rows into Node.js memory.
    // This ensures bounded memory usage for the admin dashboard even with
    // high event volume over long date ranges. The pattern matches A-068.
    // ── Daily impression trend (database aggregated) ──
    const dailyImpressions = await this.prisma.$queryRaw<
      {
        day: Date;
        total: bigint;
        billable: bigint;
      }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "isBillable")::int AS billable
      FROM ad_impressions
      WHERE "createdAt" >= ${periodStart}
      GROUP BY day
      ORDER BY day
    `;
    const impressionByDay = new Map<
      string,
      {
        total: number;
        billable: number;
      }
    >();
    let totalImpressions = 0;
    let totalBillable = 0;
    for (const imp of dailyImpressions) {
      const dayStr = imp.day.toISOString().slice(0, 10);
      const total = Number(imp.total);
      const billable = Number(imp.billable);
      impressionByDay.set(dayStr, { total, billable });
      totalImpressions += total;
      totalBillable += billable;
    }
    // ── Daily signup trend (database aggregated) ──
    const dailySignups = await this.prisma.$queryRaw<
      {
        day: Date;
        total: bigint;
        developer: bigint;
        advertiser: bigint;
      }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "role" = 'developer')::int AS developer,
             COUNT(*) FILTER (WHERE "role" = 'advertiser')::int AS advertiser
      FROM users
      WHERE "createdAt" >= ${periodStart}
      GROUP BY day
      ORDER BY day
    `;
    const signupsByDay = new Map<
      string,
      {
        total: number;
        developer: number;
        advertiser: number;
      }
    >();
    let totalSignups = 0;
    for (const sig of dailySignups) {
      const dayStr = sig.day.toISOString().slice(0, 10);
      const entry = {
        total: Number(sig.total),
        developer: Number(sig.developer),
        advertiser: Number(sig.advertiser),
      };
      signupsByDay.set(dayStr, entry);
      totalSignups += entry.total;
    }
    // ── Daily revenue from earnings ledger credits (database aggregated) ──
    const dailyRevenue = await this.prisma.$queryRaw<
      {
        day: Date;
        estimated: bigint;
        confirmed: bigint;
        paid: bigint;
        total: bigint;
      }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
              COALESCE(SUM("amountMinor") FILTER (WHERE "status" = 'estimated'), 0)::bigint AS estimated,
              COALESCE(SUM("amountMinor") FILTER (WHERE "status" = 'confirmed'), 0)::bigint AS confirmed,
              COALESCE(SUM("amountMinor") FILTER (WHERE "status" = 'paid'), 0)::bigint AS paid,
              COALESCE(SUM("amountMinor"), 0)::bigint AS total
      FROM earnings_ledger
      WHERE "createdAt" >= ${periodStart}
        AND "entryType" = 'credit'
        AND "currency" = ${reportingCurrency}
      GROUP BY day
      ORDER BY day
    `;
    const revenueByDay = new Map<
      string,
      {
        estimated: bigint;
        confirmed: bigint;
        paid: bigint;
      }
    >();
    let totalEstimatedRevenue = 0n;
    let totalConfirmedRevenue = 0n;
    let totalPaidRevenue = 0n;
    let totalRevenueAmount = 0n;
    for (const rev of dailyRevenue) {
      const dayStr = rev.day.toISOString().slice(0, 10);
      const estimated = rev.estimated;
      const confirmed = rev.confirmed;
      const paid = rev.paid;
      const total = rev.total;
      revenueByDay.set(dayStr, { estimated, confirmed, paid });
      totalEstimatedRevenue += estimated;
      totalConfirmedRevenue += confirmed;
      totalPaidRevenue += paid;
      totalRevenueAmount += total;
    }
    // ── Daily advertiser spend (database aggregated) ──
    const dailySpend = await this.prisma.$queryRaw<
      {
        day: Date;
        spend: bigint;
      }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
              COALESCE(SUM("amountMinor"), 0)::bigint AS spend
      FROM advertiser_ledger
      WHERE "createdAt" >= ${periodStart}
        AND "entryType" = 'debit'
        AND "currency" = ${reportingCurrency}
      GROUP BY day
      ORDER BY day
    `;
    const spendByDay = new Map<string, bigint>();
    let totalAdvertiserSpend = 0n;
    for (const row of dailySpend) {
      const dayStr = row.day.toISOString().slice(0, 10);
      const spend = row.spend;
      spendByDay.set(dayStr, spend);
      totalAdvertiserSpend += spend;
    }
    // ── Campaign status distribution ──
    const campaignByStatus = await this.prisma.campaign.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    // ── Active user counts (by role) ──
    const [devCount, advCount, adminCount] = await Promise.all([
      this.prisma.user.count({ where: { role: 'developer', status: 'active' } }),
      this.prisma.user.count({ where: { role: 'advertiser', status: 'active' } }),
      this.prisma.user.count({
        where: { role: { in: ['admin', 'super_admin'] as const }, status: 'active' },
      }),
    ]);
    // ── Payout stats ──
    const [totalPayouts, pendingPayouts, payoutSum] = await Promise.all([
      this.prisma.payoutRequest.count(),
      this.prisma.payoutRequest.count({ where: { status: { in: ['requested', 'under_review'] } } }),
      this.prisma.earningsLedger.aggregate({
        where: { status: 'paid', entryType: 'credit', currency: reportingCurrency },
        _sum: { amountMinor: true },
      }),
    ]);
    // ── Fill in daily time-series (fill missing days with zeros) ──
    const daily: {
      date: string;
      impressions: number;
      billableImpressions: number;
      signups: number;
      developerSignups: number;
      advertiserSignups: number;
      estimatedRevenueMinor: bigint;
      confirmedRevenueMinor: bigint;
      paidRevenueMinor: bigint;
      advertiserSpendMinor: bigint;
    }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dayStr = floorDay(d);
      const imps = impressionByDay.get(dayStr);
      const sigs = signupsByDay.get(dayStr);
      const rev = revenueByDay.get(dayStr);
      daily.push({
        date: dayStr,
        impressions: imps?.total ?? 0,
        billableImpressions: imps?.billable ?? 0,
        signups: sigs?.total ?? 0,
        developerSignups: sigs?.developer ?? 0,
        advertiserSignups: sigs?.advertiser ?? 0,
        estimatedRevenueMinor: rev?.estimated ?? 0n,
        confirmedRevenueMinor: rev?.confirmed ?? 0n,
        paidRevenueMinor: rev?.paid ?? 0n,
        advertiserSpendMinor: spendByDay.get(dayStr) ?? 0n,
      });
    }
    // ── Period-over-period comparison ──
    const [prevImpressions, prevSignups, prevRevenue] = await Promise.all([
      this.prisma.adImpression.count({
        where: { createdAt: { gte: prevPeriodStart, lt: periodStart } },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: prevPeriodStart, lt: periodStart } } }),
      this.prisma.earningsLedger.aggregate({
        where: {
          createdAt: { gte: prevPeriodStart, lt: periodStart },
          entryType: 'credit',
          currency: reportingCurrency,
        },
        _sum: { amountMinor: true },
      }),
    ]);
    // A-007: totals now computed from the database-aggregated data instead of
    // from raw arrays that were previously loaded into Node.js memory.
    const currentImpressions = totalImpressions;
    const currentSignups = totalSignups;
    const currentRevenue = totalRevenueAmount;
    const calcPct = (current: bigint | number, prev: bigint | number): number | null => {
      const cur = typeof current === 'bigint' ? Number(current) : current;
      const pr = typeof prev === 'bigint' ? Number(prev) : prev;
      return pr > 0 ? Math.round(((cur - pr) / pr) * 1000) / 10 : null;
    };
    // ── Platform ledger breakdown ──
    // Reported in the selected `reportingCurrency` so platform
    // fees / fraud reserves in non-USD buckets are not dropped.
    const platform = await this.prisma.platformLedger.aggregate({
      _sum: { amountMinor: true },
      where: { bucket: 'platform_fee', entryType: 'credit', currency: reportingCurrency },
    });
    const reserve = await this.prisma.platformLedger.aggregate({
      _sum: { amountMinor: true },
      where: { bucket: 'fraud_reserve', entryType: 'credit', currency: reportingCurrency },
    });
    return {
      currency: reportingCurrency,
      period: { days, from: floorDay(periodStart), to: floorDay(now) },
      daily,
      totals: {
        impressions: currentImpressions,
        billableImpressions: totalBillable,
        signups: currentSignups,
        estimatedRevenueMinor: totalEstimatedRevenue,
        confirmedRevenueMinor: totalConfirmedRevenue,
        paidRevenueMinor: totalPaidRevenue,
        advertiserSpendMinor: totalAdvertiserSpend,
      },
      vsPreviousPeriod: {
        impressionsChangePct: calcPct(currentImpressions, prevImpressions),
        signupsChangePct: calcPct(currentSignups, prevSignups),
        revenueChangePct: calcPct(currentRevenue, prevRevenue._sum.amountMinor ?? 0n),
      },
      activeUsers: {
        developers: devCount,
        advertisers: advCount,
        admins: adminCount,
        total: devCount + advCount + adminCount,
      },
      campaigns: {
        byStatus: campaignByStatus.map((c) => ({ status: c.status, count: c._count._all })),
        total: campaignByStatus.reduce((s, c) => s + c._count._all, 0),
      },
      payouts: {
        total: totalPayouts,
        pending: pendingPayouts,
        totalPaidMinor: payoutSum._sum.amountMinor ?? 0n,
      },
      platformRevenue: {
        platformFeeMinor: platform._sum.amountMinor ?? 0n,
        fraudReserveMinor: reserve._sum.amountMinor ?? 0n,
        totalMinor: (platform._sum.amountMinor ?? 0n) + (reserve._sum.amountMinor ?? 0n),
      },
    };
  }
}
