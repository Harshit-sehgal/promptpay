import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CampaignService } from '../campaign/campaign.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { AdvertiserService } from './advertiser.service';
import { CampaignStatus } from '@waitlayer/db';

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
    prisma.adImpression.findMany.mockResolvedValue([
      { createdAt: new Date('2026-07-09T12:00:00.000Z') },
    ]);
    prisma.adClick.findMany.mockResolvedValue([]);
  });

  it('treats a date-only `to` as inclusive of the whole end day (event at noon is included)', async () => {
    const reports = await service.getReports('adv-1', { to: '2026-07-09' });

    // The daily-impression query must bound with an EXCLUSIVE next-day `lt`,
    // so the noon event on 2026-07-09 is included.
    const where = prisma.adImpression.findMany.mock.calls[0][0].where;
    expect(where.createdAt.lt).toEqual(new Date('2026-07-10T00:00:00.000Z'));
    expect(where.createdAt.lte).toBeUndefined();

    // A-007: per-campaign impression/click counts are aggregated in the DB
    // via groupBy (not by loading every raw row into memory), and the daily
    // trend fetch selects only `createdAt` (a bounded payload).
    expect(prisma.adImpression.groupBy).toHaveBeenCalled();
    expect(prisma.adClick.groupBy).toHaveBeenCalled();
    expect(prisma.adImpression.findMany.mock.calls[0][0].select).toEqual({ createdAt: true });

    // The noon impression is counted in the summary.
    expect(reports.summary.totalImpressions).toBe(1);
    expect(reports.dailyTrend[0].impressions).toBe(1);
  });

  it('keeps an ISO-datetime `to` as an inclusive upper bound', async () => {
    await service.getReports('adv-1', { to: '2026-07-09T23:00:00.000Z' });
    const where = prisma.adImpression.findMany.mock.calls[0][0].where;
    expect(where.createdAt.lte).toEqual(new Date('2026-07-09T23:00:00.000Z'));
    expect(where.createdAt.lt).toBeUndefined();
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
    prisma.campaign.findUnique.mockResolvedValue({ id: 'c1', advertiserId: 'adv-1', status: 'approved' });
    await expect(service.pauseCampaign('c1', 'adv-1')).rejects.toThrow(BadRequestException);
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
  });

  it('pauseCampaign transitions ACTIVE -> PAUSED', async () => {
    prisma.campaign.findUnique.mockResolvedValue({ id: 'c1', advertiserId: 'adv-1', status: 'active' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique.mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'active' })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'paused' });
    const res = await service.pauseCampaign('c1', 'adv-1');
    expect(res.status).toBe('paused');
  });

  it('resumeCampaign only accepts PAUSED (rejects ACTIVE)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({ id: 'c1', advertiserId: 'adv-1', status: 'active', creatives: [{ status: 'approved' }] });
    prisma.advertiserLedger.groupBy.mockResolvedValue([]);
    await expect(service.resumeCampaign('c1', 'adv-1')).rejects.toThrow(BadRequestException);
  });

  it('resumeCampaign transitions PAUSED -> ACTIVE with approved creative + funded balance', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1', advertiserId: 'adv-1', status: 'paused',
      budgetSpentMinor: 0, budgetTotalMinor: 1000, currency: 'USD',
      creatives: [{ status: 'approved' }],
    });
    prisma.advertiserLedger.groupBy.mockResolvedValue([{ entryType: 'credit', _sum: { amountMinor: 5000 } }]);
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique.mockResolvedValueOnce({
      id: 'c1', advertiserId: 'adv-1', status: 'paused', creatives: [{ status: 'approved' }],
    }).mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'active' });
    const res = await service.resumeCampaign('c1', 'adv-1');
    expect(res.status).toBe('active');
  });

  it('updateCampaign edits a DRAFT campaign (A-021)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({ id: 'c1', advertiserId: 'adv-1', status: 'draft' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique.mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft' })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft' });
    await service.updateCampaign('c1', 'adv-1', { name: 'edited' });
    expect(prisma.campaign.updateMany).toHaveBeenCalled();
  });

  it('submitCampaign transitions DRAFT -> SUBMITTED (A-021)', async () => {
    prisma.campaign.findUnique.mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft', creatives: [{ id: 'cr' }] })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'submitted' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.adCreative.updateMany.mockResolvedValue({ count: 1 });
    const submitted = await service.submitCampaign('c1', 'adv-1');
    expect(submitted.status).toBe('submitted');
  });

  it('resetCampaignToDraft transitions REJECTED -> DRAFT (A-021)', async () => {
    prisma.campaign.findUnique.mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'rejected' })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    const reset = await service.resetCampaignToDraft('c1', 'adv-1');
    expect(reset.status).toBe('draft');
  });

  it('resubmit after reset: submitCampaign on a DRAFT created by reset (A-021)', async () => {
    prisma.campaign.findUnique.mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'draft', creatives: [{ id: 'cr' }] })
      .mockResolvedValueOnce({ id: 'c1', advertiserId: 'adv-1', status: 'submitted' });
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    prisma.adCreative.updateMany.mockResolvedValue({ count: 1 });
    const resubmitted = await service.submitCampaign('c1', 'adv-1');
    expect(resubmitted.status).toBe('submitted');
  });
});
