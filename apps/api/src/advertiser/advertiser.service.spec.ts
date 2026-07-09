import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { CampaignService } from '../campaign/campaign.service';
import { AdvertiserService, buildReportsDateFilter } from './advertiser.service';

function makePrisma() {
  // $transaction must receive the MOCK object — NOT the real PrismaClient
  // singleton imported from @waitlayer/db (which opens a real database).
  // The inline `return {...}` pattern had no local variable to capture, so
  // `cb(prisma)` resolved to the outer-scope real client → actual DB queries
  // returned {count:0} for updateMany and null for findUnique, breaking the
  // unit tests.
  const prisma = {
    advertiser: { findUnique: vi.fn() },
    campaign: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    adImpression: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    adClick: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    advertiserLedger: { groupBy: vi.fn() },
    adCreative: { updateMany: vi.fn() },
    // A-068: daily trend uses $queryRaw for server-side day-bucket aggregation.
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const campaignService = {} as unknown as CampaignService;
  const googleVerifier = { verify: vi.fn() } as unknown as GoogleTokenVerifier;
  return new AdvertiserService(prisma as any, campaignService, audit, googleVerifier);
}

describe('AdvertiserService.getDashboard CTR ratio (A-024)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
    prisma.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' });
    prisma.campaign.findMany.mockResolvedValue([
      { id: 'c1', status: 'active', creatives: [{ id: 'x', status: 'approved' }] },
    ]);
    prisma.adImpression.count.mockResolvedValue(100);
    prisma.adClick.count.mockResolvedValue(1);
    prisma.advertiserLedger.groupBy.mockResolvedValue([]);
  });

  it('returns CTR as a ratio (1 click / 100 impressions => 0.01)', async () => {
    const dash = await service.getDashboard('adv-1');
    expect(dash.ctr).toBeCloseTo(0.01, 10);
    expect(dash.totalImpressions).toBe(100);
    expect(dash.totalClicks).toBe(1);
  });
});

describe('AdvertiserService.getReports date-range end-day (A-050)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
    prisma.campaign.findMany.mockResolvedValue([
      { id: 'c1', name: 'n', status: 'active', currency: 'USD' },
    ]);
    prisma.adImpression.groupBy.mockResolvedValue([{ campaignId: 'c1', _count: { _all: 1 } }]);
    prisma.adClick.groupBy.mockResolvedValue([{ campaignId: 'c1', _count: { _all: 0 } }]);
    prisma.advertiserLedger.groupBy.mockResolvedValue([]);
    prisma.campaign.count.mockResolvedValue(1);
    // A-068: daily trend uses $queryRaw for server-side SQL day-bucket
    // aggregation instead of loading raw rows via findMany. The mock receives
    // a tagged-template call (strings, ...values); join for inspection.
    prisma.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray | string, ..._values: any[]) => {
        const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
        if (sql.includes('ad_impressions')) {
          return Promise.resolve([{ day: new Date('2026-07-09T12:00:00.000Z'), count: 1n }]);
        }
        if (sql.includes('ad_clicks')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    );
  });

  it('treats a date-only `to` as inclusive of the whole end day (event at noon is included)', async () => {
    // A-050: a date-only `to` uses an EXCLUSIVE next-day `lt` bound so the
    // noon event on 2026-07-09 is included.
    const createdAt = buildReportsDateFilter(undefined, '2026-07-09');
    expect(createdAt.lt).toEqual(new Date('2026-07-10T00:00:00.000Z'));
    expect(createdAt.lte).toBeUndefined();

    const reports = await service.getReports('adv-1', { to: '2026-07-09' });

    // A-007/A-068: per-campaign counts via groupBy + daily trend via $queryRaw.
    expect(prisma.adImpression.groupBy).toHaveBeenCalled();
    expect(prisma.adClick.groupBy).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();

    // The noon impression is counted in the summary and daily trend.
    expect(reports.summary.totalImpressions).toBe(1);
    expect(reports.dailyTrend[0].impressions).toBe(1);
  });

  it('keeps an ISO-datetime `to` as an inclusive upper bound', async () => {
    const createdAt = buildReportsDateFilter(undefined, '2026-07-09T23:00:00.000Z');
    expect(createdAt.lte).toEqual(new Date('2026-07-09T23:00:00.000Z'));
    expect(createdAt.lt).toBeUndefined();

    // End-to-end: the SQL aggregation path must not throw and must produce a
    // daily trend for the ISO-datetime range.
    const reports = await service.getReports('adv-1', { to: '2026-07-09T23:00:00.000Z' });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(Array.isArray(reports.dailyTrend)).toBe(true);
  });

  it('excludes events on the day after a date-only `to` (next-day noon is outside the `lt` bound)', async () => {
    // A-050: a date-only `to` becomes an EXCLUSIVE next-day `lt` bound
    // (2026-07-10T00:00:00Z). An event at noon on 2026-07-10 must therefore be
    // excluded because it is strictly >= the bound.
    const createdAt = buildReportsDateFilter(undefined, '2026-07-09');
    expect(createdAt.lt).toEqual(new Date('2026-07-10T00:00:00.000Z'));
    expect(new Date('2026-07-10T12:00:00.000Z').getTime()).toBeGreaterThanOrEqual(
      createdAt.lt!.getTime(),
    );

    // The bound must be passed through to the SQL aggregation path as `lt`,
    // so a query scoped to date-only `to` cannot pull the next-day event.
    await service.getReports('adv-1', { to: '2026-07-09' });
    const impCall = prisma.adImpression.groupBy.mock.calls[0][0];
    expect(impCall.where.createdAt).toMatchObject({ lt: new Date('2026-07-10T00:00:00.000Z') });
  });
});

describe('AdvertiserService.getReports pagination + range bounds (A-032)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
    prisma.campaign.findMany.mockResolvedValue([
      { id: 'c1', name: 'n', status: 'active', currency: 'USD' },
    ]);
    prisma.campaign.count.mockResolvedValue(1);
    prisma.adImpression.groupBy.mockResolvedValue([{ campaignId: 'c1', _count: { _all: 1 } }]);
    prisma.adClick.groupBy.mockResolvedValue([{ campaignId: 'c1', _count: { _all: 0 } }]);
    prisma.advertiserLedger.groupBy.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('returns all campaigns when no page/limit is supplied (UI default)', async () => {
    const reports = await service.getReports('adv-1', { to: '2026-07-09' });
    expect(prisma.campaign.count).toHaveBeenCalled();
    expect(prisma.campaign.findMany.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(prisma.campaign.findMany.mock.calls[0][0]).not.toHaveProperty('take');
    expect(reports.total).toBe(1);
    expect(reports.page).toBe(1);
  });

  it('caps an over-large limit at REPORT_MAX_LIMIT (1000)', async () => {
    await service.getReports('adv-1', { to: '2026-07-09', page: 1, limit: 5000 });
    expect(prisma.campaign.findMany.mock.calls[0][0]).toMatchObject({ take: 1000, skip: 0 });
  });

  it('applies page + limit as skip/take', async () => {
    await service.getReports('adv-1', { to: '2026-07-09', page: 3, limit: 25 });
    expect(prisma.campaign.findMany.mock.calls[0][0]).toMatchObject({ take: 25, skip: 50 });
  });

  it('rejects a date range wider than the allowed span', async () => {
    await expect(
      service.getReports('adv-1', { from: '2020-01-01', to: '2026-07-09' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns accurate page, limit, and total in the response', async () => {
    prisma.campaign.count.mockResolvedValue(5);
    prisma.campaign.findMany.mockResolvedValue([
      { id: 'c1', name: 'n', status: 'active', currency: 'USD' },
    ]);
    const reports = await service.getReports('adv-1', { to: '2026-07-09', page: 2, limit: 10 });
    expect(reports.page).toBe(2);
    expect(reports.limit).toBe(10);
    expect(reports.total).toBe(5);
  });

  it('reports limit as REPORT_MAX_LIMIT when clamped', async () => {
    prisma.campaign.count.mockResolvedValue(1);
    const reports = await service.getReports('adv-1', { to: '2026-07-09', page: 1, limit: 5000 });
    expect(reports.limit).toBe(1000);
    expect(reports.page).toBe(1);
  });
});

describe('AdvertiserService campaign state machine (A-020, A-021)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
  });

  it('pauseCampaign only accepts ACTIVE (rejects APPROVED)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'approved',
    });
    await expect(service.pauseCampaign('c1', 'adv-1')).rejects.toThrow(BadRequestException);
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
  });

  it('pauseCampaign transitions ACTIVE -> PAUSED', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'active',
    });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'active' })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'paused' });
    const res = await service.pauseCampaign('c1', 'adv-1');
    expect(res.status).toBe('paused');
  });

  it('resumeCampaign only accepts PAUSED (rejects ACTIVE)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'active',
      creatives: [{ status: 'approved' }],
    });
    prisma.advertiserLedger.groupBy.mockResolvedValue([]);
    await expect(service.resumeCampaign('c1', 'adv-1')).rejects.toThrow(BadRequestException);
  });

  it('resumeCampaign transitions PAUSED -> ACTIVE with approved creative + funded balance', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'paused',
      budgetSpentMinor: 0,
      budgetTotalMinor: 1000,
      currency: 'USD',
      creatives: [{ status: 'approved' }],
    });
    prisma.advertiserLedger.groupBy.mockResolvedValue([
      { entryType: 'credit', _sum: { amountMinor: 5000 } },
    ]);
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        advertiserId: 'adv-1',
        status: 'paused',
        creatives: [{ status: 'approved' }],
      })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'active' });
    const res = await service.resumeCampaign('c1', 'adv-1');
    expect(res.status).toBe('active');
  });

  it('updateCampaign edits a DRAFT campaign (A-021)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'draft',
    });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft' })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft' });
    await service.updateCampaign('c1', 'adv-1', { name: 'edited' });
    expect(prisma.campaign.updateMany).toHaveBeenCalled();
  });

  it('submitCampaign transitions DRAFT -> SUBMITTED (A-021)', async () => {
    prisma.campaign.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        advertiserId: 'adv-1',
        status: 'draft',
        creatives: [{ id: 'cr' }],
      })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'submitted' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.adCreative.updateMany.mockResolvedValue({ count: 1 });
    const submitted = await service.submitCampaign('c1', 'adv-1');
    expect(submitted.status).toBe('submitted');
  });

  it('resetCampaignToDraft transitions REJECTED -> DRAFT (A-021)', async () => {
    prisma.campaign.findUnique
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'rejected' })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    const reset = await service.resetCampaignToDraft('c1', 'adv-1');
    expect(reset.status).toBe('draft');
  });

  it('resubmit after reset: submitCampaign on a DRAFT created by reset (A-021)', async () => {
    prisma.campaign.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        advertiserId: 'adv-1',
        status: 'draft',
        creatives: [{ id: 'cr' }],
      })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'submitted' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.adCreative.updateMany.mockResolvedValue({ count: 1 });
    const resubmitted = await service.submitCampaign('c1', 'adv-1');
    expect(resubmitted.status).toBe('submitted');
  });
});
