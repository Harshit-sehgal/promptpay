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
        findUnique: vi.fn(),
        update: vi.fn(),
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
    prisma.adImpression.findUnique.mockResolvedValue({
      id: 'imp-1',
      qualifiedAt: null,
      invalidatedAt: null,
    });

    const result = await cron.tick();

    expect(result.reclaimed).toBe(1);
    expect(result.scanned).toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.adImpression.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'imp-1' },
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
    prisma.adImpression.findUnique.mockResolvedValue({
      id: 'imp-1',
      qualifiedAt: new Date(),
      invalidatedAt: null,
    });

    const result = await cron.tick();

    expect(result.reclaimed).toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips when it cannot acquire the cron lease', async () => {
    vi.mocked(cronLease.acquireCronLease).mockResolvedValue(false);
    const result = await cron.tick();
    expect(result).toEqual({ reclaimed: 0, scanned: 0 });
    expect(prisma.adImpression.findMany).not.toHaveBeenCalled();
  });
});
