import { NotFoundException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { CampaignStatus, primaryCurrency } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import {
  buildReportsDateFilter,
  DASHBOARD_CAMPAIGN_SLICE,
  REPORT_MAX_LIMIT,
} from './advertiser.constants';
import { reportsToCsv } from './reports-csv';

export class AdvertiserDashboardTrait {
  declare prisma: PrismaService;

  /** Get advertiser dashboard with aggregated metrics */
  async getDashboard(advertiserId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({ where: { id: advertiserId } });
    if (!advertiser) throw new NotFoundException('Advertiser not found');
    const campaigns = await this.prisma.campaign.findMany({
      where: { advertiserId },
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_CAMPAIGN_SLICE,
      include: {
        creatives: {
          select: { id: true, status: true, rejectionReason: true },
        },
        approvals: {
          where: { decision: 'rejected' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { reason: true },
        },
      },
    });
    const campaignSummaries = campaigns.map((campaign) => {
      const { approvals = [], ...summary } = campaign;
      return {
        ...summary,
        rejectionReason: campaign.status === 'rejected' ? (approvals[0]?.reason ?? null) : null,
      };
    });
    // A-024: count impressions and clicks over the same population (this
    // advertiser's campaigns) so CTR = validClicks / totalImpressions is
    // internally consistent. Impressions are not restricted to billable here
    // because a valid click can only arise from a served impression; mixing a
    // billable-only denominator with an isValid numerator would skew the ratio.
    const totalImpressions = await this.prisma.adImpression.count({
      where: { campaign: { advertiserId } },
    });
    const totalClicks = await this.prisma.adClick.count({
      where: { campaign: { advertiserId }, isValid: true },
    });
    const spend = await this.prisma.advertiserLedger.groupBy({
      by: ['currency'],
      where: { advertiserId, entryType: 'debit', status: { in: ['confirmed', 'paid'] } },
      _sum: { amountMinor: true },
    });
    const totalSpendByCurrency = Object.fromEntries(
      spend.map((row) => [row.currency, row._sum.amountMinor ?? 0n]),
    );
    const spendCurrency = primaryCurrency(totalSpendByCurrency);
    return {
      totalSpendMinor: totalSpendByCurrency[spendCurrency] ?? 0n,
      currency: spendCurrency,
      totalSpendByCurrency,
      totalImpressions,
      totalClicks,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      activeCampaigns: await this.prisma.campaign.count({
        where: { advertiserId, status: 'active' },
      }),
      totalCampaigns: await this.prisma.campaign.count({ where: { advertiserId } }),
      campaigns: campaignSummaries,
    };
  }

  /**
   * A-074: bounded, paginated campaign list for the advertiser campaigns page.
   * Replaces the dashboard's unbounded campaign array as the list source and
   * returns only the requested page slice plus an accurate total count.
   */
  async listCampaigns(
    advertiserId: string,
    query: {
      page?: number;
      limit?: number;
      status?: string;
    } = {},
  ) {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)));
    const where: Prisma.CampaignWhereInput = { advertiserId };
    if (query.status) where.status = query.status as CampaignStatus;
    const [rows, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          creatives: { select: { id: true, status: true, rejectionReason: true } },
          approvals: {
            where: { decision: 'rejected' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { reason: true },
          },
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);
    const campaigns = rows.map((campaign) => {
      const { approvals = [], ...summary } = campaign;
      return {
        ...summary,
        rejectionReason: campaign.status === 'rejected' ? (approvals[0]?.reason ?? null) : null,
      };
    });
    return { campaigns, total, page, limit };
  }

  /**
   * A-074: single-campaign detail for the advertiser edit flow. Replaces the
   * previous pattern of loading the whole dashboard and searching the array
   * for one campaign id (which did not scale and could miss campaigns outside
   * the dashboard's recent slice).
   */
  async getCampaign(advertiserId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        creatives: { select: { id: true, status: true, rejectionReason: true } },
        approvals: {
          where: { decision: 'rejected' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { reason: true },
        },
      },
    });
    if (!campaign || campaign.advertiserId !== advertiserId) {
      throw new NotFoundException('Campaign not found');
    }
    const { approvals = [], ...summary } = campaign;
    return {
      ...summary,
      rejectionReason: campaign.status === 'rejected' ? (approvals[0]?.reason ?? null) : null,
    };
  }

  /** Get advertiser billing balance and recent advertiser-ledger entries. */
  async getBilling(advertiserId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: advertiserId },
      select: { id: true },
    });
    if (!advertiser) throw new NotFoundException('Advertiser not found');
    const [totals, entries] = await Promise.all([
      this.prisma.advertiserLedger.groupBy({
        by: ['currency', 'entryType'],
        where: {
          advertiserId,
          entryType: { in: ['credit', 'debit', 'refund'] },
          status: 'confirmed',
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.advertiserLedger.findMany({
        where: { advertiserId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          campaignId: true,
          entryType: true,
          status: true,
          amountMinor: true,
          currency: true,
          description: true,
          stripePaymentIntentId: true,
          stripeDisputeId: true,
          createdAt: true,
        },
      }),
    ]);
    const byCurrency = new Map<
      string,
      {
        currency: string;
        balanceMinor: bigint;
        totalDepositsMinor: bigint;
        totalChargesMinor: bigint;
        totalRefundsMinor: bigint;
      }
    >();
    for (const row of totals) {
      const currency = row.currency.toUpperCase();
      const current = byCurrency.get(currency) ?? {
        currency,
        balanceMinor: 0n,
        totalDepositsMinor: 0n,
        totalChargesMinor: 0n,
        totalRefundsMinor: 0n,
      };
      const amount = row._sum.amountMinor ?? 0n;
      if (row.entryType === 'credit') current.totalDepositsMinor += amount;
      if (row.entryType === 'debit') current.totalChargesMinor += amount;
      if (row.entryType === 'refund') current.totalRefundsMinor += amount;
      // Use the centralized formula: credits − debits − refunds (A-066, A-054).
      current.balanceMinor =
        current.totalDepositsMinor - current.totalChargesMinor - current.totalRefundsMinor;
      byCurrency.set(currency, current);
    }
    const balances = Array.from(byCurrency.values()).sort((a, b) => {
      if (a.currency === 'USD') return -1;
      if (b.currency === 'USD') return 1;
      return a.currency.localeCompare(b.currency);
    });
    const primary = balances[0] ?? {
      currency: 'USD',
      balanceMinor: 0n,
      totalDepositsMinor: 0n,
      totalChargesMinor: 0n,
      totalRefundsMinor: 0n,
    };
    return {
      ...primary,
      totalRefundsMinor: primary.totalRefundsMinor,
      balances,
      entries,
    };
    return {
      ...primary,
      totalRefundsMinor: primary.totalRefundsMinor,
      balances,
      entries,
    };
  }

  /** Get reports for advertiser campaigns — aggregated by campaign */
  async getReports(
    advertiserId: string,
    params: {
      campaignId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const campaignWhere: Prisma.CampaignWhereInput = { advertiserId };
    if (params.campaignId) campaignWhere.id = params.campaignId;
    // A-032: apply caller-supplied pagination only when explicitly requested.
    // The web UI never sends `page`/`limit`, so it keeps receiving every
    // campaign; API consumers are capped at REPORT_MAX_LIMIT rows per page.
    const page =
      Number.isInteger(params.page) && (params.page as number) > 0 ? (params.page as number) : 1;
    const limit =
      Number.isInteger(params.limit) && (params.limit as number) > 0
        ? Math.min(params.limit as number, REPORT_MAX_LIMIT)
        : undefined;
    const totalCampaigns = await this.prisma.campaign.count({ where: campaignWhere });
    const campaignQuery: Prisma.CampaignFindManyArgs = {
      where: campaignWhere,
      select: { id: true, name: true, status: true, currency: true },
    };
    if (limit !== undefined) {
      campaignQuery.skip = (page - 1) * limit;
      campaignQuery.take = limit;
    }
    const campaigns = await this.prisma.campaign.findMany(campaignQuery);
    const campaignIds = campaigns.map((campaign) => campaign.id);
    // Parse + normalize the date range into a Prisma `createdAt` filter
    // (issue A-050). A date-ONLY `to` (no 'T', e.g. "2026-07-09") is parsed by
    // `new Date(...)` as midnight at the START of that day, which would exclude
    // every impression/click that happened later on the selected end day. We
    // treat a date-only `to` as inclusive-of-the-day by using an exclusive
    // next-day UTC lower bound (`lt`); ISO datetimes are kept as an inclusive
    // upper bound (`lte`). The next-day bound is computed in UTC so it lines up
    // with how `new Date(params.to)` parses a date-only string (UTC midnight).
    const createdAt = buildReportsDateFilter(params.from, params.to);
    const timeFilter = Object.keys(createdAt).length > 0 ? { createdAt } : {};
    // Aggregate impressions + clicks per campaign in the database (groupBy)
    // instead of loading every raw billable row into application memory (A-007).
    const impCounts = await this.prisma.adImpression.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, isBillable: true, ...timeFilter },
      _count: { _all: true },
    });
    const impByCampaign = new Map<string, number>(
      impCounts.map((r) => [r.campaignId, r._count._all]),
    );
    const clickCounts = await this.prisma.adClick.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, isValid: true, ...timeFilter },
      _count: { _all: true },
    });
    const clicksByCampaign = new Map<string, number>(
      clickCounts.map((r) => [r.campaignId, r._count._all]),
    );
    // Get spend per campaign from advertiser ledger
    const spendRows = await this.prisma.advertiserLedger.groupBy({
      by: ['campaignId', 'currency'],
      where: {
        advertiserId,
        campaignId: { in: campaignIds },
        entryType: 'debit',
        status: { in: ['confirmed', 'paid'] },
        ...timeFilter,
      },
      _sum: { amountMinor: true },
    });
    const spendByCampaignCurrency = new Map(
      spendRows.map((r) => [`${r.campaignId}:${r.currency}`, r._sum.amountMinor ?? 0n]),
    );
    // Daily aggregation for trend chart (issue A-068). Bucket impressions and
    // clicks by day directly in SQL via `date_trunc` so that a wide date range
    // returns at most one row per day instead of streaming every event
    // timestamp into application memory.
    const timeConditions: Prisma.Sql[] = [];
    if (createdAt.gte) timeConditions.push(Prisma.sql`"createdAt" >= ${createdAt.gte}`);
    if (createdAt.lte) timeConditions.push(Prisma.sql`"createdAt" <= ${createdAt.lte}`);
    if (createdAt.lt) timeConditions.push(Prisma.sql`"createdAt" < ${createdAt.lt}`);
    const timeClause = timeConditions.length
      ? Prisma.sql` AND ${Prisma.join(timeConditions, ' AND ')}`
      : Prisma.sql``;
    const dailyImpressions = await this.prisma.$queryRaw<
      {
        day: Date;
        count: bigint;
      }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
      FROM ad_impressions
      WHERE "campaignId" IN (${Prisma.join(campaignIds)}) AND "isBillable" = true${timeClause}
      GROUP BY day
      ORDER BY day
    `;
    const dailyClicks = await this.prisma.$queryRaw<
      {
        day: Date;
        count: bigint;
      }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
      FROM ad_clicks
      WHERE "campaignId" IN (${Prisma.join(campaignIds)}) AND "isValid" = true${timeClause}
      GROUP BY day
      ORDER BY day
    `;
    const dailyMap = new Map<
      string,
      {
        impressions: number;
        clicks: number;
        date: string;
      }
    >();
    for (const imp of dailyImpressions) {
      const day = imp.day.toISOString().slice(0, 10);
      const entry = dailyMap.get(day) ?? { date: day, impressions: 0, clicks: 0 };
      entry.impressions += Number(imp.count);
      dailyMap.set(day, entry);
    }
    for (const click of dailyClicks) {
      const day = click.day.toISOString().slice(0, 10);
      const entry = dailyMap.get(day) ?? { date: day, impressions: 0, clicks: 0 };
      entry.clicks += Number(click.count);
      dailyMap.set(day, entry);
    }
    const dailyTrend = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    // Build per-campaign rows
    const rows = campaigns.map((campaign) => {
      const impressions = impByCampaign.get(campaign.id) ?? 0;
      const clicks = clicksByCampaign.get(campaign.id) ?? 0;
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const spendMinor = spendByCampaignCurrency.get(`${campaign.id}:${campaign.currency}`) ?? 0n;
      return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status,
        impressions,
        clicks,
        ctr,
        spendMinor,
        currency: campaign.currency,
      };
    });
    // Summary
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totalSpendByCurrency = rows.reduce<Record<string, bigint>>((totals, row) => {
      totals[row.currency] = (totals[row.currency] ?? 0n) + row.spendMinor;
      return totals;
    }, {});
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    return {
      rows,
      dailyTrend,
      summary: {
        totalImpressions,
        totalClicks,
        totalSpendMinor: totalSpendByCurrency[primaryCurrency(totalSpendByCurrency)] ?? 0n,
        currency: primaryCurrency(totalSpendByCurrency),
        totalSpendByCurrency,
        avgCtr,
        totalCampaigns,
      },
      page,
      limit: limit ?? (rows.length || 1),
      total: totalCampaigns,
    };
  }

  /** Serialize the campaign report rows to CSV for advertiser export. */
  async exportReportsCsv(
    advertiserId: string,
    params: {
      campaignId?: string;
      from?: string;
      to?: string;
    },
  ): Promise<string> {
    const result = await this.getReports(advertiserId, { ...params, limit: 1000 });
    return reportsToCsv(result.rows);
  }
}
