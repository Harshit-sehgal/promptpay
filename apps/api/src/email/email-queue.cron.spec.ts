import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../config/prisma.service';
import { EmailService } from './email.service';
import { EmailQueueCron } from './email-queue.cron';
import { EmailQueueService } from './email-queue.service';

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

  const mockQueue = {
    decrypt: vi.fn((s: string) => s),
    encrypt: vi.fn((s: string) => `v1:encrypted:${s}`),
  } as unknown as EmailQueueService;

  let cron: EmailQueueCron;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: lease acquired, no queued rows.
    mockPrisma.$queryRaw.mockResolvedValue([{ key: 'email-queue-process' }]);
    cron = new EmailQueueCron(mockPrisma, mockEmail, mockQueue);
  });

  it('acquires the cross-replica cron lease before processing', async () => {
    await cron.processQueue();
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    const rawQuery = mockPrisma.$queryRaw.mock.calls[0][0] as {
      strings: readonly string[];
      values: readonly unknown[];
    };
    // acquireCronLease uses a parameterized Prisma.sql template, so the lease
    // key is a bound value (not inline SQL text).
    expect(rawQuery.strings.join('')).toContain('cron_leases');
    expect(rawQuery.values).toContain('email-queue-process');
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
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
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

  it('uses FOR UPDATE SKIP LOCKED to fetch due rows', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([]);
    await cron.processQueue();
    // First $queryRaw is the cron lease; the batch fetch is the second call.
    const rawQuery = mockPrisma.$queryRaw.mock.calls[1][0] as {
      strings: readonly string[];
      values: readonly unknown[];
    };
    const sql = rawQuery.strings.join('');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('email_queue');
  });

  it('updates retry count when retry fails', async () => {
    mockEmail.send.mockResolvedValueOnce({ delivered: false, driver: 'resend' });
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
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
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
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
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
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
