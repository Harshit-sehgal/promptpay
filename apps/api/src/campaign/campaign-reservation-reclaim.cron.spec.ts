import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cronLease from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';
import { CampaignReservationReclaimCron } from './campaign-reservation-reclaim.cron';

describe('CampaignReservationReclaimCron', () => {
  let prisma: any;
  let cron: CampaignReservationReclaimCron;

  beforeEach(() => {
    vi.spyOn(cronLease, 'acquireCronLease').mockResolvedValue(true);
    prisma = {
      adImpression: {
        findMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };
    cron = new CampaignReservationReclaimCron(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reclaims stale CPM impressions and releases their reservation', async () => {
    prisma.adImpression.findMany.mockResolvedValue([
      {
        id: 'imp-1',
        campaignId: 'camp-1',
        campaign: { bidAmountMinor: 100n, budgetReservedMinor: 100n },
      },
    ]);
    const result = await cron.tick();

    expect(result.reclaimed).toBe(1);
    expect(result.scanned).toBe(1);
    expect(prisma.adImpression.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaign: { bidType: 'cpm', status: { in: ['active', 'paused'] } },
        }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.adImpression.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'imp-1', qualifiedAt: null, invalidatedAt: null },
        data: expect.objectContaining({
          invalidationReason: 'stale_reservation',
          isBillable: false,
        }),
      }),
    );
  });

  it('skips impressions already qualified or invalidated', async () => {
    prisma.adImpression.findMany.mockResolvedValue([
      {
        id: 'imp-1',
        campaignId: 'camp-1',
        campaign: { bidAmountMinor: 100n, budgetReservedMinor: 100n },
      },
    ]);
    prisma.adImpression.updateMany.mockResolvedValue({ count: 0 });

    const result = await cron.tick();

    expect(result.reclaimed).toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('commits invalidation when the reservation was already released', async () => {
    prisma.adImpression.findMany.mockResolvedValue([
      {
        id: 'imp-1',
        campaignId: 'camp-1',
        campaign: { bidAmountMinor: 100n, budgetReservedMinor: 100n },
      },
    ]);
    prisma.$executeRaw.mockResolvedValue(0);

    const result = await cron.tick();

    expect(result.reclaimed).toBe(0);
    expect(prisma.adImpression.updateMany).toHaveBeenCalledTimes(1);
  });

  it('skips when it cannot acquire the cron lease', async () => {
    vi.mocked(cronLease.acquireCronLease).mockResolvedValue(false);
    const result = await cron.tick();
    expect(result).toEqual({ reclaimed: 0, scanned: 0 });
    expect(prisma.adImpression.findMany).not.toHaveBeenCalled();
  });
});
