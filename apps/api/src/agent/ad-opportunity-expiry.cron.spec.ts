import { describe, expect, it, vi } from 'vitest';

import { AdOpportunityExpiryCron } from './ad-opportunity-expiry.cron';

describe('AdOpportunityExpiryCron', () => {
  it('expires only stale candidate projections', async () => {
    const prisma = {
      adOpportunity: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    } as any;
    const cron = new AdOpportunityExpiryCron(prisma);
    const result = await cron.tick();
    expect(result).toEqual({ acquired: true, expired: 3 });
    expect(prisma.adOpportunity.updateMany).toHaveBeenCalledWith({
      where: { state: 'candidate', expiresAt: { lte: expect.any(Date) } },
      data: { state: 'expired', rejectionReason: 'opportunity_expired' },
    });
  });

  it('does not update when another replica owns the lease', async () => {
    const prisma = {
      adOpportunity: { updateMany: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as any;
    const result = await new AdOpportunityExpiryCron(prisma).tick();
    expect(result).toEqual({ acquired: false, expired: 0 });
    expect(prisma.adOpportunity.updateMany).not.toHaveBeenCalled();
  });
});
