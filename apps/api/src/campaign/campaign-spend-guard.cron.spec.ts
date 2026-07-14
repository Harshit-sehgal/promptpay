import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../audit/audit.service';
import * as cronLease from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';
import { CampaignSpendGuardCron } from './campaign-spend-guard.cron';

/**
 * Default advertiser-ledger rows used to give the "healthy" / "exhausted"
 * campaigns a positive funded balance so the cron's balance check returns
 * `current + credits = 5000` and doesn't trip the
 * `advertiser_balance_depleted` branch. The "no funded balance" test
 * overrides `prisma.advertiserLedger.groupBy` to return an empty list,
 * making `getAdvertiserBalance` resolve to 0n.
 *
 * The rows are shaped as a real Prisma `groupBy` result: one object per
 * (entryType, status) group with `_sum.amountMinor`. Note `amountMinor` is
 * number here (the mock mirrors Prisma's JSON serialization), and the
 * production helper wraps it with `BigInt(row._sum.amountMinor ?? 0)`.
 */
const FUNDED_BALANCE_ROWS = [
  { entryType: 'credit', status: 'confirmed', _sum: { amountMinor: 5000 } },
];

describe('CampaignSpendGuardCron', () => {
  let prisma: any;
  let audit: AuditService;
  let cron: CampaignSpendGuardCron;

  beforeEach(() => {
    vi.spyOn(cronLease, 'acquireCronLease').mockResolvedValue(true);
    audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    prisma = {
      campaign: { findMany: vi.fn(), updateMany: vi.fn() },
      // Default: every advertiser is funded (5000 minor units). Tests that
      // exercise the unfunded branch override this mock per-test.
      advertiserLedger: { groupBy: vi.fn().mockResolvedValue(FUNDED_BALANCE_ROWS) },
    };
    cron = new CampaignSpendGuardCron(prisma as unknown as PrismaService, audit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pauses campaigns that have exhausted their budget', async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: 'camp-1',
        name: 'Exhausted',
        advertiserId: 'adv-1',
        currency: 'USD',
        budgetTotalMinor: 1000n,
        budgetSpentMinor: 1000n,
        budgetReservedMinor: 0n,
      },
    ]);
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });

    const result = await cron.tick();

    expect(result.paused).toBe(1);
    expect(result.scanned).toBe(1);
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'camp-1', status: 'active' },
      data: { status: 'paused', pausedAt: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalled();
  });

  it('pauses campaigns whose advertiser has no funded balance', async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: 'camp-2',
        name: 'Unfunded',
        advertiserId: 'adv-2',
        currency: 'USD',
        budgetTotalMinor: 1000n,
        budgetSpentMinor: 0n,
        budgetReservedMinor: 0n,
      },
    ]);
    prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    // No ledger rows → getAdvertiserBalance resolves to 0n → the cron trips
    // the `advertiser_balance_depleted` branch and pauses the campaign.
    prisma.advertiserLedger.groupBy.mockResolvedValue([]);

    const result = await cron.tick();

    expect(result.paused).toBe(1);
    expect(result.scanned).toBe(1);
  });

  it('does not pause healthy campaigns', async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: 'camp-3',
        name: 'Healthy',
        advertiserId: 'adv-3',
        currency: 'USD',
        budgetTotalMinor: 1000n,
        budgetSpentMinor: 100n,
        budgetReservedMinor: 0n,
      },
    ]);
    prisma.campaign.updateMany.mockResolvedValue({ count: 0 });

    const result = await cron.tick();

    expect(result.paused).toBe(0);
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
  });

  it('skips when it cannot acquire the cron lease', async () => {
    vi.mocked(cronLease.acquireCronLease).mockResolvedValue(false);
    const result = await cron.tick();
    expect(result).toEqual({ paused: 0, scanned: 0 });
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
  });

  it('is idempotent when another process already paused the campaign', async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: 'camp-1',
        name: 'Exhausted',
        advertiserId: 'adv-1',
        currency: 'USD',
        budgetTotalMinor: 1000n,
        budgetSpentMinor: 1000n,
        budgetReservedMinor: 0n,
      },
    ]);
    prisma.campaign.updateMany.mockResolvedValue({ count: 0 });

    const result = await cron.tick();

    expect(result.paused).toBe(0);
  });
});
