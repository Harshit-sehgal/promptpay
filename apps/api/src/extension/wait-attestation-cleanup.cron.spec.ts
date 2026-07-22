import { describe, expect, it, vi } from 'vitest';

import { WaitAttestationCleanupCron } from './wait-attestation-cleanup.cron';

describe('WaitAttestationCleanupCron', () => {
  it('archives expired unconsumed sessions instead of deleting referenced audit records', async () => {
    const prisma = {
      waitAttestationSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        deleteMany: vi.fn(),
      },
    };
    const cron = new WaitAttestationCleanupCron(prisma as never);

    await expect(cron.runCleanup()).resolves.toBe(2);

    expect(prisma.waitAttestationSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        consumedAt: null,
        expiredAt: null,
        consumeDeadline: { lt: expect.any(Date) },
      }),
      data: { expiredAt: expect.any(Date) },
    });
    expect(prisma.waitAttestationSession.deleteMany).not.toHaveBeenCalled();
  });

  it('does not overlap cleanup runs', async () => {
    let release!: () => void;
    const prisma = {
      waitAttestationSession: {
        updateMany: vi.fn(
          () => new Promise<{ count: number }>((resolve) => (release = () => resolve({ count: 1 }))),
        ),
      },
    };
    const cron = new WaitAttestationCleanupCron(prisma as never);

    const first = cron.runCleanup();
    await expect(cron.runCleanup()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(1);
  });
});
