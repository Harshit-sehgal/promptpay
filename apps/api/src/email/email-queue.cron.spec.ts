import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../config/prisma.service';
import { EmailService } from './email.service';
import { EmailQueueCron } from './email-queue.cron';
import { EmailQueueService } from './email-queue.service';

describe('EmailQueueCron', () => {
  const mockEmailQueue = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  };
  const mockQueryRaw = vi.fn().mockResolvedValue([{ key: 'email-queue-process' }]);
  // The batch fetch + per-row mutations now run inside $transaction(async tx => ...).
  // The tx client must surface the same emailQueue mock and the same $queryRaw
  // so the test's chained mockResolvedValueOnce(lease) then (batch) sequence and
  // its emailQueue.delete/update assertions stay intact.
  const mockPrisma = {
    emailQueue: mockEmailQueue,
    $queryRaw: mockQueryRaw,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
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

  it('gives up after max retries and parks the row with a terminal-marker (Round 38)', async () => {
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

    // Round 38: the row is parked (update) rather than deleted, so ops can
    // inspect why a security-critical email was permanently dropped. The
    // terminal `lastError` marker + far-future `nextRetryAt` keeps the row
    // out of the retry batch until the `expiresAt` purge eventually removes
    // it.
    expect(mockPrisma.emailQueue.delete).not.toHaveBeenCalled();
    expect(mockPrisma.emailQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-3' },
        data: expect.objectContaining({
          retryCount: 9,
          lastError: 'permanent_failure_exhausted_retries',
        }),
      }),
    );
    expect(result.permanentFailures).toBe(1);
    expect(result.stillFailing).toBe(0);
  });

  it('isolates a per-row decrypt failure so it cannot roll back the batch (Round 38)', async () => {
    // First row: a corrupt ciphertext throws in decrypt() — must not abort
    // the batch and re-deliver the already-sent second row on the next tick.
    mockQueue.decrypt.mockImplementation((value: string) => {
      if (value === 'bad-row-html') {
        throw new Error('Malformed encrypted email payload');
      }
      return value;
    });
    // Only the good row reaches email.send — the bad row's decrypt throws
    // before send, so a single delivered:true mock is sufficient.
    mockEmail.send.mockResolvedValueOnce({ delivered: true, driver: 'resend' });
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
        {
          id: 'q-bad',
          to: 'a@b.com',
          subject: 'Hello',
          html: 'bad-row-html',
          text: null,
          retryCount: 0,
        },
        {
          id: 'q-good',
          to: 'c@d.com',
          subject: 'World',
          html: '<p>hi</p>',
          text: 'hi',
          retryCount: 0,
        },
      ]);

    const result = await cron.processQueue();

    // The bad row is parked with terminal-failure marker; the good row is
    // delivered and deleted.
    expect(mockPrisma.emailQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-bad' },
        data: expect.objectContaining({
          lastError: 'permanent_failure_exhausted_retries',
        }),
      }),
    );
    expect(mockPrisma.emailQueue.delete).toHaveBeenCalledWith({ where: { id: 'q-good' } });
    expect(result.permanentFailures).toBe(1);
    expect(result.delivered).toBe(1);
  });

  it('refuses to throw the per-row decrypt() error out of the cron (Round 38)', async () => {
    mockQueue.decrypt.mockImplementation((value: string) => {
      if (value === 'corrupt') {
        throw new Error('AES-GCM auth tag mismatch');
      }
      return value;
    });
    mockEmail.send.mockResolvedValue({ delivered: false, driver: 'resend' });
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
        {
          id: 'q-poison',
          to: 'a@b.com',
          subject: 'Hello',
          html: 'corrupt',
          text: null,
          retryCount: 0,
        },
      ]);

    // The cron must not propagate the decrypt error (would abort the whole
    // $transaction and re-send already-delivered siblings on the next tick).
    await expect(cron.processQueue()).resolves.toEqual(
      expect.objectContaining({ permanentFailures: 1 }),
    );
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
