import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '../app.module';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailQueueCron } from '../email/email-queue.cron';
import { EmailQueueService } from '../email/email-queue.service';

/**
 * The email-queue cron leases rows with a RAW query, and a raw query's type
 * parameter is an UNCHECKED assertion — TypeScript cannot verify it against the
 * database. `retryCount` is `@map("retry_count")`, so a `SELECT *` handed the
 * code `retry_count` while `EmailQueueRow` still promised `retryCount: number`.
 *
 * Every unit test mocks `$queryRaw` and returns a camelCase row the database
 * never produces, so the entire suite stayed green while, in production:
 *   - `job.retryCount + 1` was NaN,
 *   - `retryCount >= MAX_RETRIES` was never true (rows retried forever),
 *   - the backoff became an Invalid Date, and
 *   - the failure-path `update()` aborted the whole batch transaction, halting
 *     delivery of password-reset and email-verification mail.
 *
 * These tests run the cron against the REAL database so the projection is
 * proven, not asserted.
 */
describe('EmailQueueCron against a real database', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cron: EmailQueueCron;
  let queue: EmailQueueService;
  const send = vi.fn();
  let previousRedisUrl: string | undefined;

  const RECIPIENT = 'email-queue-cron-integration@ateva.test';

  beforeAll(async () => {
    previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = '';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ send })
      .compile();
    prisma = moduleRef.get(PrismaService);
    cron = moduleRef.get(EmailQueueCron);
    queue = moduleRef.get(EmailQueueService);
  });

  afterAll(async () => {
    await prisma?.emailQueue.deleteMany({ where: { to: RECIPIENT } });
    await moduleRef?.close();
    process.env.REDIS_URL = previousRedisUrl;
  });

  beforeEach(async () => {
    send.mockReset();
    await prisma.emailQueue.deleteMany({ where: { to: RECIPIENT } });
    // `processQueue` no-ops unless it wins the cross-replica cron lease, which
    // is held for 55s by whichever nodeId ran last. Without releasing it a
    // back-to-back run silently does nothing and every assertion below fails
    // for a reason that has nothing to do with the code under test.
    await prisma.cronLease.deleteMany({ where: { key: 'email-queue-process' } });
  });

  async function enqueue(retryCount: number): Promise<string> {
    const row = await prisma.emailQueue.create({
      data: {
        to: RECIPIENT,
        subject: 'Queued subject',
        html: queue.encrypt('<p>queued body</p>'),
        text: queue.encrypt('queued body'),
        contentHash: `email-queue-cron-integration-${retryCount}-${Date.now()}`,
        retryCount,
        nextRetryAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    return row.id;
  }

  it('reads the mapped retry_count column and increments it on a failed send', async () => {
    const id = await enqueue(1);
    send.mockResolvedValue({ delivered: false, driver: 'resend' });

    await cron.processQueue();

    const row = await prisma.emailQueue.findUnique({ where: { id } });
    // The whole point: if the projection regressed to `SELECT *`, this would be
    // NaN and the update would have thrown instead of writing 2.
    expect(row?.retryCount).toBe(2);
    expect(Number.isNaN(row?.nextRetryAt.getTime())).toBe(false);
    expect(row?.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
    expect(row?.lastError).toContain('delivery_failed');
  });

  it('parks a row that has exhausted its retries instead of retrying forever', async () => {
    // MAX_RETRIES is 8; a row already at 8 must terminate on this pass.
    const id = await enqueue(8);
    send.mockResolvedValue({ delivered: false, driver: 'resend' });

    await cron.processQueue();

    const row = await prisma.emailQueue.findUnique({ where: { id } });
    expect(row?.lastError).toBe('permanent_failure_exhausted_retries');
    // Parked far enough out that the cron never re-pulls it before the
    // expiresAt purge removes it.
    expect(row?.nextRetryAt.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60_000);
  });

  it('does not abort the batch when one row is undeliverable', async () => {
    const poison = await enqueue(0);
    const healthy = await enqueue(0);
    // The poison row throws inside the per-row block; the healthy one delivers.
    send.mockImplementation(async ({ to }: { to: string }) => {
      if (send.mock.calls.length === 1) throw new Error('provider exploded');
      expect(to).toBe(RECIPIENT);
      return { delivered: true, driver: 'resend' };
    });

    await expect(cron.processQueue()).resolves.toBeDefined();

    const rows = await prisma.emailQueue.findMany({ where: { to: RECIPIENT } });
    const ids = rows.map((row) => row.id);
    // The delivered row is removed; the poison row is retained for triage.
    expect(ids).not.toContain(healthy);
    expect(ids).toContain(poison);
    const parked = rows.find((row) => row.id === poison);
    expect(parked?.retryCount).toBe(1);
    expect(parked?.lastError).toBe('permanent_failure_exhausted_retries');
  });
});
