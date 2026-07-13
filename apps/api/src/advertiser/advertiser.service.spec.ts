import * as bcrypt from 'bcryptjs';
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
    user: { findUnique: vi.fn(), update: vi.fn() },
    advertiser: { findUnique: vi.fn(), update: vi.fn() },
    campaign: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    adImpression: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn(),
    },
    adClick: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn(),
    },
    advertiserLedger: { groupBy: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    earningsLedger: { aggregate: vi.fn(), findFirst: vi.fn() },
    recoveryDebtCase: { findFirst: vi.fn() },
    payoutRequest: { findFirst: vi.fn() },
    deviceRecoveryToken: { updateMany: vi.fn() },
    session: { updateMany: vi.fn() },
    apiKey: { updateMany: vi.fn() },
    payoutAccount: { updateMany: vi.fn() },
    userSettings: { updateMany: vi.fn() },
    waitStateEvent: { updateMany: vi.fn() },
    auditLog: { updateMany: vi.fn() },
    adCreative: { updateMany: vi.fn(), findMany: vi.fn() },
    consent: { findMany: vi.fn() },
    // A-068: daily trend uses $queryRaw for server-side day-bucket aggregation.
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

function prepareErasureMocks(prisma: ReturnType<typeof makePrisma>) {
  prisma.earningsLedger.aggregate.mockResolvedValue({ _sum: { amountMinor: 0n } });
  prisma.earningsLedger.findFirst.mockResolvedValue(null);
  prisma.recoveryDebtCase.findFirst.mockResolvedValue(null);
  prisma.payoutRequest.findFirst.mockResolvedValue(null);
  prisma.advertiserLedger.groupBy.mockResolvedValue([]);
  prisma.advertiserLedger.findFirst.mockResolvedValue(null);
  prisma.campaign.findFirst.mockResolvedValue(null);
  prisma.campaign.updateMany.mockResolvedValue({ count: 0 });
  prisma.deviceRecoveryToken.updateMany.mockResolvedValue({ count: 0 });
  prisma.session.updateMany.mockResolvedValue({ count: 0 });
  prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });
  prisma.payoutAccount.updateMany.mockResolvedValue({ count: 0 });
  prisma.userSettings.updateMany.mockResolvedValue({ count: 0 });
  prisma.waitStateEvent.updateMany.mockResolvedValue({ count: 0 });
  prisma.adImpression.updateMany.mockResolvedValue({ count: 0 });
  prisma.adClick.updateMany.mockResolvedValue({ count: 0 });
  prisma.auditLog.updateMany.mockResolvedValue({ count: 0 });
  prisma.$executeRaw.mockResolvedValue(1);
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

  it('surfaces rejected campaign and creative reasons without leaking approval rows', async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: 'c1',
        status: 'rejected',
        creatives: [{ id: 'cr1', status: 'rejected', rejectionReason: 'Creative copy is unclear' }],
        approvals: [{ reason: 'Campaign category is not eligible' }],
      },
    ]);

    const dash = await service.getDashboard('adv-1');

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          creatives: { select: { id: true, status: true, rejectionReason: true } },
          approvals: expect.objectContaining({
            where: { decision: 'rejected' },
            take: 1,
            select: { reason: true },
          }),
        }),
      }),
    );
    expect(dash.campaigns[0]).toMatchObject({
      id: 'c1',
      status: 'rejected',
      rejectionReason: 'Campaign category is not eligible',
      creatives: [{ id: 'cr1', status: 'rejected', rejectionReason: 'Creative copy is unclear' }],
    });
    expect(dash.campaigns[0]).not.toHaveProperty('approvals');
  });
});

describe('AdvertiserService.exportData truncation metadata (A-072)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
    prisma.advertiser.findUnique.mockResolvedValue({ id: 'adv-1', userId: 'user-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'adv@test.com' });
    prisma.campaign.findMany.mockResolvedValue(
      Array.from({ length: 1001 }, (_, i) => ({ id: `campaign_${i}` })),
    );
    prisma.adCreative.findMany.mockResolvedValue([{ id: 'creative_1' }]);
    prisma.advertiserLedger.findMany.mockResolvedValue(
      Array.from({ length: 10001 }, (_, i) => ({ id: `ledger_${i}` })),
    );
    prisma.consent.findMany.mockResolvedValue(
      Array.from({ length: 1001 }, (_, i) => ({ id: `consent_${i}` })),
    );
  });

  it('adds explicit truncation metadata for capped advertiser collections', async () => {
    const exported = await service.exportData('user-1');

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1001, orderBy: { createdAt: 'desc' } }),
    );
    expect(prisma.adCreative.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2001, orderBy: { createdAt: 'desc' } }),
    );
    expect(prisma.advertiserLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10001 }),
    );
    expect(exported.campaigns).toHaveLength(1000);
    expect(exported.creatives).toHaveLength(1);
    expect(exported.billingLedger).toHaveLength(10000);
    expect(exported.consent).toHaveLength(1000);
    expect(exported.exportMeta).toMatchObject({
      exportType: 'self_service_recent_activity',
      complete: false,
      truncated: true,
      collections: {
        campaigns: { limit: 1000, returned: 1000, truncated: true },
        creatives: { limit: 2000, returned: 1, truncated: false },
        billingLedger: { limit: 10000, returned: 10000, truncated: true },
        consent: { limit: 1000, returned: 1000, truncated: true },
      },
    });
  });
});

describe('AdvertiserService.deleteAccount financial preflight and erasure', () => {
  it('pseudonymizes advertiser identity only after financial obligations are clear', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    prepareErasureMocks(prisma);
    const passwordHash = await bcrypt.hash('correct-password', 12);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'advertiser@example.com',
      status: 'active',
      passwordHash,
      googleId: null,
    });
    prisma.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' });

    await expect(
      service.deleteAccount('user-1', { currentPassword: 'correct-password' }),
    ).resolves.toEqual({ deleted: true });
    expect(prisma.advertiser.update).toHaveBeenCalledWith({
      where: { id: 'adv-1' },
      data: expect.objectContaining({
        billingEmail: 'deleted-user-1@waitlayer.com',
        stripeCustomerId: null,
      }),
    });
    expect(prisma.payoutAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
  });

  it('blocks deletion while advertiser funds remain', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    prepareErasureMocks(prisma);
    const passwordHash = await bcrypt.hash('correct-password', 12);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'advertiser@example.com',
      status: 'active',
      passwordHash,
      googleId: null,
    });
    prisma.advertiser.findUnique.mockResolvedValue({ id: 'adv-1' });
    prisma.advertiserLedger.groupBy.mockResolvedValue([
      { currency: 'USD', entryType: 'credit', _sum: { amountMinor: 100n } },
    ] as never);

    await expect(
      service.deleteAccount('user-1', { currentPassword: 'correct-password' }),
    ).rejects.toThrow(/funded balance/);
    expect(prisma.user.update).not.toHaveBeenCalled();
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

describe('AdvertiserService.listCampaigns (A-074)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;
  const base = {
    id: 'c1',
    name: 'A',
    status: 'active',
    bidType: 'cpm',
    bidAmountMinor: 200,
    budgetTotalMinor: 10000,
    budgetSpentMinor: 0,
    currency: 'USD',
    creatives: [],
    approvals: [],
  };

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
  });

  it('paginates and returns the total count without loading every campaign', async () => {
    const all = Array.from({ length: 25 }, (_unused: number, i: number) => ({
      ...base,
      id: `c${i}`,
    }));
    prisma.campaign.findMany.mockImplementation((args: { skip?: number; take?: number }) => {
      const skip = args?.skip ?? 0;
      const take = args?.take ?? 20;
      return Promise.resolve(all.slice(skip, skip + take));
    });
    prisma.campaign.count.mockResolvedValue(25);

    const res = await service.listCampaigns('adv-1', { page: 2, limit: 10 });
    expect(res.total).toBe(25);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(10);
    expect(res.campaigns.length).toBe(10);
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('filters by status', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    prisma.campaign.count.mockResolvedValue(0);
    await service.listCampaigns('adv-1', { status: 'active' });
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { advertiserId: 'adv-1', status: 'active' } }),
    );
  });
});

describe('AdvertiserService.getCampaign (A-074)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
  });

  it('returns a single owned campaign', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'draft',
      creatives: [{ id: 'x', status: 'pending' }],
      approvals: [],
    });
    const res = await service.getCampaign('adv-1', 'c1');
    expect(res.id).toBe('c1');
  });

  it('throws NotFound for a missing or non-owned campaign', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'other',
      creatives: [],
      approvals: [],
    });
    await expect(service.getCampaign('adv-1', 'c1')).rejects.toThrow();
    prisma.campaign.findUnique.mockResolvedValue(null);
    await expect(service.getCampaign('adv-1', 'c2')).rejects.toThrow();
  });
});

describe('AdvertiserService.updateCampaign currency (A-081)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdvertiserService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'draft',
    });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'draft',
      currency: 'EUR',
    });
  });

  it('applies a normalized currency change on a draft', async () => {
    await service.updateCampaign('c1', 'adv-1', { currency: 'eur' });
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currency: 'EUR' }),
        where: expect.objectContaining({ status: 'draft' }),
      }),
    );
  });

  it('rejects a currency change on a non-draft campaign', async () => {
    prisma.campaign.findUnique.mockResolvedValueOnce({
      id: 'c1',
      advertiserId: 'adv-1',
      status: 'active',
    });
    await expect(service.updateCampaign('c1', 'adv-1', { currency: 'EUR' })).rejects.toThrow();
  });
});
