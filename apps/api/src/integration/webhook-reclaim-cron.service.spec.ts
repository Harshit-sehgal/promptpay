import { describe, expect, it, vi } from 'vitest';

import { WebhookReclaimCronService } from './webhook-reclaim-cron.service';

function makeMocks() {
  const prisma = {
    webhookEvent: {
      findMany: vi.fn((args: any) => {
        const statuses = args?.where?.processingStatus?.in ?? [];
        const lt = args?.where?.updatedAt?.lt;
        const all = (prisma.webhookEvent as any)._rows ?? [];
        return Promise.resolve(
          all.filter(
            (r: any) => statuses.includes(r.processingStatus) && (!lt || r.updatedAt < lt),
          ),
        );
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      _rows: [] as any[],
    },
  };
  // Helper to seed the rows the mock will filter on.
  (prisma.webhookEvent as any).seed = (rows: any[]) => {
    (prisma.webhookEvent as any)._rows = rows;
  };
  const eventBus = {
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
  return { prisma: prisma as any, eventBus: eventBus as any };
}

const orphanRow = (id: string, ageMs: number) => ({
  id,
  provider: 'stripe',
  eventId: `evt_${id}`,
  processingStatus: 'processing',
  payload: { id: `evt_${id}`, type: 'checkout.session.completed' },
  updatedAt: new Date(Date.now() - ageMs),
});

describe('WebhookReclaimCronService (A-062)', () => {
  const ORIGINAL_ENV = process.env.WEBHOOK_RECLAIM_CRON;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.WEBHOOK_RECLAIM_CRON;
    else process.env.WEBHOOK_RECLAIM_CRON = ORIGINAL_ENV;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.restoreAllMocks();
  });

  it('does nothing when explicitly disabled outside production', async () => {
    process.env.NODE_ENV = 'test';
    process.env.WEBHOOK_RECLAIM_CRON = 'false';
    const { prisma, eventBus } = makeMocks();
    const service = new WebhookReclaimCronService(prisma, eventBus);

    const result = await service.reclaimOrphanedWebhooks();

    expect(result).toEqual({ found: 0, requeued: 0 });
    expect(prisma.webhookEvent.findMany).not.toHaveBeenCalled();
    expect(eventBus.dispatch).not.toHaveBeenCalled();
  });

  it('is enabled by default in production when the override is absent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WEBHOOK_RECLAIM_CRON;
    const { prisma, eventBus } = makeMocks();
    prisma.webhookEvent.seed([orphanRow('prod', 40 * 60 * 1000)]);
    const service = new WebhookReclaimCronService(prisma, eventBus);

    await expect(service.reclaimOrphanedWebhooks()).resolves.toEqual({ found: 1, requeued: 1 });
  });

  it('re-queues orphaned rows when enabled', async () => {
    process.env.WEBHOOK_RECLAIM_CRON = 'true';
    const { prisma, eventBus } = makeMocks();
    prisma.webhookEvent.seed([orphanRow('a', 40 * 60 * 1000)]);
    const service = new WebhookReclaimCronService(prisma, eventBus);

    const result = await service.reclaimOrphanedWebhooks();

    expect(result).toEqual({ found: 1, requeued: 1 });
    expect(prisma.webhookEvent.findMany).toHaveBeenCalledTimes(1);
    // Row reset to 'pending' before reprocessing.
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'a',
          processingStatus: 'processing',
          updatedAt: expect.any(Date),
        },
        data: { processingStatus: 'pending' },
      }),
    );
    expect(eventBus.dispatch).toHaveBeenCalledWith('stripe.webhook', {
      event: orphanRow('a', 0).payload,
    });
  });

  it('ignores rows younger than the orphan age threshold', async () => {
    process.env.WEBHOOK_RECLAIM_CRON = 'true';
    const { prisma, eventBus } = makeMocks();
    // Updated only 5 minutes ago — within the 35-min reclaim threshold.
    prisma.webhookEvent.seed([orphanRow('b', 5 * 60 * 1000)]);
    const service = new WebhookReclaimCronService(prisma, eventBus);

    const result = await service.reclaimOrphanedWebhooks();

    expect(result).toEqual({ found: 0, requeued: 0 });
    expect(eventBus.dispatch).not.toHaveBeenCalled();
  });

  it('re-queues multiple orphaned rows in one run', async () => {
    process.env.WEBHOOK_RECLAIM_CRON = 'true';
    const { prisma, eventBus } = makeMocks();
    prisma.webhookEvent.seed([orphanRow('a', 40 * 60 * 1000), orphanRow('b', 50 * 60 * 1000)]);
    const service = new WebhookReclaimCronService(prisma, eventBus);

    const result = await service.reclaimOrphanedWebhooks();

    expect(result).toEqual({ found: 2, requeued: 2 });
    expect(eventBus.dispatch).toHaveBeenCalledTimes(2);
  });

  it('skips rows whose payload is not a parseable Stripe event', async () => {
    process.env.WEBHOOK_RECLAIM_CRON = 'true';
    const { prisma, eventBus } = makeMocks();
    prisma.webhookEvent.seed([{ ...orphanRow('bad', 40 * 60 * 1000), payload: null }]);
    const service = new WebhookReclaimCronService(prisma, eventBus);

    const result = await service.reclaimOrphanedWebhooks();

    expect(result).toEqual({ found: 1, requeued: 0 });
    expect(eventBus.dispatch).not.toHaveBeenCalled();
  });
});
