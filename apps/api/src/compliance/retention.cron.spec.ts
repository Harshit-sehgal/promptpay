import { describe, expect, it, vi } from 'vitest';

import { ComplianceService } from './compliance.service';

function makeService() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    dataRetentionConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const service = new ComplianceService(prisma as never, {} as never);
  return { service, prisma, tx };
}

describe('bounded multi-replica retention', () => {
  it('skips the tick when another replica owns the advisory lock', async () => {
    const { service, tx } = makeService();
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);

    await expect(service.runAllRetention()).resolves.toEqual({ acquired: false, deleted: 0 });
    expect(tx.dataRetentionConfig.findMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('deletes in bounded batches and stops after a short final batch', async () => {
    const { service, tx } = makeService();
    tx.dataRetentionConfig.findMany.mockResolvedValue([
      { category: 'webhook_events', retainDays: 90 },
    ]);
    tx.$executeRaw.mockResolvedValueOnce(500).mockResolvedValueOnce(500).mockResolvedValueOnce(12);

    await expect(service.runAllRetention()).resolves.toEqual({ acquired: true, deleted: 1012 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('caps work per category even when every batch is full', async () => {
    const { service, tx } = makeService();
    tx.dataRetentionConfig.findMany.mockResolvedValue([{ category: 'sessions', retainDays: 30 }]);
    tx.$executeRaw.mockResolvedValue(500);

    await expect(service.runAllRetention()).resolves.toEqual({ acquired: true, deleted: 5000 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(10);
  });

  it('rejects a negative retention window before deleting anything', async () => {
    const { service, tx } = makeService();
    tx.dataRetentionConfig.findUnique.mockResolvedValue({
      category: 'audit_logs',
      retainDays: -1,
    });

    await expect(service.purge('audit_logs')).rejects.toThrow(/must be positive/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects a zero retention window (Round 37 — would purge everything instantly)', async () => {
    const { service, tx } = makeService();
    tx.dataRetentionConfig.findUnique.mockResolvedValue({
      category: 'audit_logs',
      retainDays: 0,
    });

    await expect(service.purge('audit_logs')).rejects.toThrow(/must be positive/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
