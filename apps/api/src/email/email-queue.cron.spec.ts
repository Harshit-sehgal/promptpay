import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../config/prisma.service';
import { EmailService } from './email.service';
import { EmailQueueCron } from './email-queue.cron';

describe('EmailQueueCron', () => {
  const mockPrisma = {
    emailQueue: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ key: 'email-queue-process' }]),
  } as unknown as PrismaService;

  const mockEmail = {
    send: vi.fn().mockResolvedValue({ delivered: true, driver: 'resend' }),
  } as unknown as EmailService;

  let cron: EmailQueueCron;

  beforeEach(() => {
    vi.clearAllMocks();
    cron = new EmailQueueCron(mockPrisma, mockEmail);
  });

  it('acquires the cross-replica cron lease before processing', async () => {
    await cron.processQueue();
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    const rawQuery = mockPrisma.$queryRaw.mock.calls[0][0];
    expect(rawQuery).toContain('email-queue-process');
  });

  it('purges expired rows before processing', async () => {
    mockPrisma.emailQueue.findMany.mockResolvedValue([]);
    const result = await cron.processQueue();
    expect(mockPrisma.emailQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { lt: expect.any(Date) } },
      }),
    );
    expect(result.purged).toBe(0);
  });

  it('deletes queued row when retry succeeds', async () => {
    mockPrisma.emailQueue.findMany.mockResolvedValue([
      {
        id: 'q-1',
        to: 'a@b.com',
        subject: 'Hello',
        html: '<p>hi</p>',
        text: 'hi',
        retryCount: 2,
      },
    ]);

    const result = await cron.processQueue();

    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', html: '<p>hi</p>' }),
    );
    expect(mockPrisma.emailQueue.delete).toHaveBeenCalledWith({ where: { id: 'q-1' } });
    expect(result.delivered).toBe(1);
    expect(result.stillFailing).toBe(0);
    expect(result.permanentFailures).toBe(0);
  });

  it('updates retry count when retry fails', async () => {
    mockEmail.send.mockResolvedValueOnce({ delivered: false, driver: 'resend' });
    mockPrisma.emailQueue.findMany.mockResolvedValue([
      {
        id: 'q-2',
        to: 'a@b.com',
        subject: 'Hello',
        html: '<p>hi</p>',
        text: 'hi',
        retryCount: 1,
      },
    ]);

    const result = await cron.processQueue();

    expect(mockPrisma.emailQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-2' },
        data: expect.objectContaining({ retryCount: 2 }),
      }),
    );
    expect(result.stillFailing).toBe(1);
    expect(result.permanentFailures).toBe(0);
  });

  it('gives up after max retries and deletes the row', async () => {
    mockEmail.send.mockResolvedValueOnce({ delivered: false, driver: 'resend' });
    mockPrisma.emailQueue.findMany.mockResolvedValue([
      {
        id: 'q-3',
        to: 'a@b.com',
        subject: 'Hello',
        html: '<p>hi</p>',
        text: 'hi',
        retryCount: 8,
      },
    ]);

    const result = await cron.processQueue();

    expect(mockPrisma.emailQueue.delete).toHaveBeenCalledWith({ where: { id: 'q-3' } });
    expect(result.permanentFailures).toBe(1);
    expect(result.stillFailing).toBe(0);
  });

  it('only retries due rows and purges expired rows', async () => {
    mockEmail.send.mockResolvedValueOnce({ delivered: true, driver: 'resend' });
    mockPrisma.emailQueue.deleteMany.mockResolvedValueOnce({ count: 3 });
    mockPrisma.emailQueue.findMany.mockResolvedValue([
      {
        id: 'q-due',
        to: 'due@b.com',
        subject: 'Due',
        html: '<p>due</p>',
        text: 'due',
        retryCount: 0,
      },
    ]);

    const result = await cron.processQueue();

    expect(mockPrisma.emailQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { lt: expect.any(Date) } },
      }),
    );
    expect(mockEmail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'due@b.com' }));
    expect(result.purged).toBe(3);
    expect(result.delivered).toBe(1);
  });
});
