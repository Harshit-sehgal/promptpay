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
    // The claim step marks the selected rows before the transaction commits,
    // so the batch is hidden from other runners while this process sends.
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const mockQueryRaw = vi.fn().mockResolvedValue([{ key: 'email-queue-process' }]);
  // Only the CLAIM runs inside $transaction now — the sends and the per-row
  // record steps run against `prisma` directly, because holding a transaction
  // across up to 50 provider calls exceeded Prisma's 5s interactive-transaction
  // timeout and stalled the queue permanently. The tx client still surfaces the
  // same emailQueue mock and $queryRaw, so the chained lease-then-batch
  // sequence and the delete/update assertions stay valid either way.
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

  /**
   * The queue must drain even when the batch takes longer than a database
   * transaction may live.
   *
   * The sends used to run inside the batch transaction to hold the SKIP LOCKED
   * lease. Prisma's interactive transactions default to a 5s timeout, and a
   * full batch is BATCH_SIZE (50) provider calls of up to 10s each. On the live
   * staging host this produced "A query cannot be executed on an expired
   * transaction ... 5800 ms passed": the expiry threw on the next query, the
   * transaction rolled back, and nothing was delivered or recorded. The run
   * repeated every minute and failed identically — the queue could never drain,
   * and it carries password-reset and email-verification mail.
   *
   * This asserts the shape that makes that impossible: the transaction closes
   * before any send happens.
   */
  it('sends outside the transaction, so a slow provider cannot expire it', async () => {
    let txOpen = false;
    let sentWhileTxOpen = 0;

    vi.mocked(mockPrisma.$transaction).mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        txOpen = true;
        const out = await cb(mockPrisma);
        txOpen = false;
        return out;
      },
    );

    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
        { id: 'q-1', to: 'a@b.com', subject: 's', html: 'h', text: 't', retryCount: 0 },
        { id: 'q-2', to: 'c@d.com', subject: 's', html: 'h', text: 't', retryCount: 0 },
      ]);

    vi.mocked(mockEmail.send).mockImplementation(async () => {
      if (txOpen) sentWhileTxOpen++;
      return { delivered: true, driver: 'resend' };
    });

    const result = await cron.processQueue();

    expect(sentWhileTxOpen, 'no send may happen while the transaction is open').toBe(0);
    expect(result.delivered).toBe(2);
    expect(mockPrisma.emailQueue.delete).toHaveBeenCalledTimes(2);
  });

  it('claims the batch so a concurrent runner cannot pick the same rows up', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
        { id: 'q-1', to: 'a@b.com', subject: 's', html: 'h', text: 't', retryCount: 0 },
      ]);

    await cron.processQueue();

    // The claim pushes next_retry_at beyond now, so the other runner's
    // `next_retry_at <= NOW()` filter stops matching these rows.
    expect(mockPrisma.emailQueue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['q-1'] } },
        data: expect.objectContaining({ nextRetryAt: expect.any(Date) }),
      }),
    );
    const claimed = vi.mocked(mockPrisma.emailQueue.updateMany).mock.calls[0][0] as {
      data: { nextRetryAt: Date };
    };
    expect(claimed.data.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('parks a permanently rejected row instead of retrying it for hours', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'email-queue-process' }])
      .mockResolvedValueOnce([
        { id: 'q-1', to: 'a@b.com', subject: 's', html: 'h', text: 't', retryCount: 0 },
      ]);
    vi.mocked(mockEmail.send).mockResolvedValueOnce({
      delivered: false,
      driver: 'resend',
      permanent: true,
    });

    const result = await cron.processQueue();

    expect(result.permanentFailures).toBe(1);
    expect(result.stillFailing).toBe(0);
    const parked = vi.mocked(mockPrisma.emailQueue.update).mock.calls[0][0] as {
      data: { lastError: string; nextRetryAt: Date };
    };
    // Terminal now, not after eight rounds of backoff against a refusal that
    // will be identical every time.
    expect(parked.data.lastError).toContain('permanent_failure');
    expect(parked.data.nextRetryAt.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
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

    // `retryCount` is `@map("retry_count")`. A raw query returns DB column
    // names, and its `<EmailQueueRow[]>` type parameter is an UNCHECKED
    // assertion — so `SELECT *` compiled fine while `job.retryCount` was
    // `undefined` at runtime. That produced NaN arithmetic: the give-up branch
    // never fired, backoff became an Invalid Date, and the failure-path update
    // aborted the whole batch transaction, stopping the entire email queue.
    // Every mock below hands the code a camelCase row the database never
    // returns, so only asserting the projection can catch this.
    expect(sql).toContain('"retry_count" AS "retryCount"');
    expect(sql).not.toContain('SELECT *');
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

    // the row is parked (update) rather than deleted, so ops can
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
