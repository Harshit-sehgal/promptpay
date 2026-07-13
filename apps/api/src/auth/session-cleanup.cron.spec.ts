import { describe, expect, it, vi } from 'vitest';

import { SessionCleanupCron } from './session-cleanup.cron';

function makeCron() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { cron: new SessionCleanupCron(prisma as never), prisma, tx };
}

describe('SessionCleanupCron', () => {
  it('skips when another replica owns the advisory lock', async () => {
    const { cron, tx } = makeCron();
    tx.$queryRaw.mockResolvedValue([{ acquired: false }]);

    await expect(cron.runCleanup()).resolves.toEqual({ acquired: false, deleted: 0 });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('deletes expired sessions in bounded batches', async () => {
    const { cron, tx } = makeCron();
    tx.$executeRaw.mockResolvedValueOnce(500).mockResolvedValueOnce(17);

    await expect(cron.runCleanup()).resolves.toEqual({ acquired: true, deleted: 517 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('caps a single run even while every batch is full', async () => {
    const { cron, tx } = makeCron();
    tx.$executeRaw.mockResolvedValue(500);

    await expect(cron.runCleanup()).resolves.toEqual({ acquired: true, deleted: 5000 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(10);
  });

  it('keeps its in-process overlap guard in addition to the database lock', async () => {
    const { cron, prisma } = makeCron();
    (cron as unknown as { running: boolean }).running = true;

    await expect(cron.runCleanup()).resolves.toEqual({ acquired: false, deleted: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
