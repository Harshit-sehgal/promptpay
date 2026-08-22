import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { Prisma } from '@ateva/db';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { acquireCronLease } from '../common/utils/cron-lease';
import { privacyPseudonym } from '../common/utils/privacy-hash';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';

interface EmailQueueRow {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string | null;
  retryCount: number;
}

/**
 * Processes queued transactional emails with exponential backoff.
 *
 * - Runs every minute via setInterval.
 * - Acquires a cross-replica cron lease.
 * - Uses FOR UPDATE SKIP LOCKED for row-level leases.
 * - Purges expired rows (e.g. dead password-reset tokens).
 * - Retries due rows; deletes on success, updates nextRetryAt on failure.
 * - Gives up after 8 attempts (~4 hours total) to avoid infinite retries.
 *
 * SECURITY NOTE: the queue stores rendered email HTML, which may contain
 * password-reset or email-verification tokens. Access to the `email_queue`
 * table must be restricted to the same level as session/token tables.
 */
@Injectable()
export class EmailQueueCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueueCron.name);
  private readonly nodeId = randomUUID();
  private intervalId?: NodeJS.Timeout;
  private readonly LEASE_TTL_MS = 55_000;
  private readonly BATCH_SIZE = 50;
  /**
   * How long a claimed row is hidden from other runners while this process
   * sends it.
   *
   * Must exceed the worst case for a whole batch — BATCH_SIZE (50) sends at up
   * to EMAIL_PROVIDER_TIMEOUT_MS (10s) each is ~500s — so a slow provider
   * cannot let a second replica pick up a row this one is still sending. If
   * the process dies mid-batch the claim expires and the rows return, which
   * costs a bounded delay rather than a duplicate security email.
   */
  private readonly CLAIM_LEASE_MS = 15 * 60_000;
  private readonly MAX_RETRIES = 8;
  private readonly INTERVAL_MS = 60_000;
  // Written to `lastError` when a row exhausts retries (or is unprocessable),
  // and paired with a far-future `nextRetryAt` so the cron never re-pulls the
  // row. Keeping the row (instead of deleting it) leaves a forensic trail for
  // ops to inspect why a security-critical email — password-reset, verify,
  // account-deleted — was permanently dropped. The row is eventually removed
  // by the `expiresAt < now()` purge below.
  private readonly PERMANENT_FAILURE_MARKER = 'permanent_failure_exhausted_retries';
  // Pushed ~30 days into the future to park terminal rows out of the retry
  // window while `expiresAt` cleanup runs.
  private readonly PERMANENT_FAILURE_PARK_MS = 30 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly queue: EmailQueueService,
  ) {}

  async onApplicationBootstrap() {
    if (!backgroundJobsEnabled()) return;
    this.logger.log('Starting email queue processing cron...');
    // Fire-and-forget startup run, then poll every minute.
    void this.processQueue().catch((err: unknown) => {
      this.logger.error(
        `Email queue startup run failed: ${err instanceof Error ? err.message : err}`,
      );
    });

    this.intervalId = setInterval(() => {
      void this.processQueue().catch((err: unknown) => {
        this.logger.error(`Email queue run failed: ${err instanceof Error ? err.message : err}`);
      });
    }, this.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Email queue processing cron stopped.');
    }
  }

  async processQueue(): Promise<{
    purged: number;
    processed: number;
    delivered: number;
    stillFailing: number;
    permanentFailures: number;
  }> {
    if (
      !(await acquireCronLease(this.prisma, 'email-queue-process', this.nodeId, this.LEASE_TTL_MS))
    ) {
      return { purged: 0, processed: 0, delivered: 0, stillFailing: 0, permanentFailures: 0 };
    }

    // Purge expired rows before processing.
    const { count: purged } = await this.prisma.emailQueue.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (purged > 0) {
      this.logger.log(`Purged ${purged} expired email queue row(s)`);
    }

    // Claim, then send, then record — three short steps instead of one long
    // transaction.
    //
    // The send used to happen INSIDE the batch transaction, to hold the
    // SKIP LOCKED lease so two replicas could not send the same email twice.
    // The guarantee was right; the shape was not. Prisma's interactive
    // transaction timeout defaults to 5s, and this batch is up to BATCH_SIZE
    // (50) sequential provider calls of up to EMAIL_PROVIDER_TIMEOUT_MS (10s)
    // each — 500s of network I/O against a 5s budget. Even at 100ms per send,
    // 50 sends reaches the limit exactly.
    //
    // Observed on the live staging host: "A query cannot be executed on an
    // expired transaction. The timeout for this transaction was 5000 ms,
    // however 5800 ms passed". The expiry throws on the next query inside the
    // tx, which lands in the per-row catch and is logged as "Dropping
    // unprocessable queued email" — misleading, because the transaction then
    // rolls back and nothing is dropped, recorded, or delivered. The run
    // repeats every minute and fails identically: once enough rows are due,
    // THE QUEUE CAN NEVER DRAIN, and it carries password-reset and
    // email-verification mail.
    //
    // Claiming preserves the duplicate-prevention the transaction existed for:
    // the claim pushes `next_retry_at` beyond now, so a concurrent runner's
    // `next_retry_at <= NOW()` filter no longer sees the row. If this process
    // dies mid-batch the claim simply expires and the rows come back — a
    // bounded delay instead of a permanent stall.
    const batch = await this.prisma.$transaction(async (tx) => {
      // Select an EXPLICIT aliased column list, never `SELECT *`.
      // `retryCount` is `@map("retry_count")`, so `SELECT *` returns
      // `retry_count` and `job.retryCount` was `undefined` at runtime — while
      // `EmailQueueRow` still declared it a `number`, because a raw query's
      // type parameter is an unchecked assertion. The fallout was silent and
      // total: `job.retryCount + 1` produced NaN, so `retryCount >= MAX_RETRIES`
      // was never true (rows retried forever), the backoff computed an Invalid
      // Date, and the failure-path `update()` then aborted the whole batch
      // transaction — one undeliverable email stopped the entire queue,
      // including password-reset and email-verification mail.
      const rows = (await tx.$queryRaw<EmailQueueRow[]>(
        Prisma.sql`
          SELECT
            "id",
            "to",
            "subject",
            "html",
            "text",
            "retry_count" AS "retryCount"
          FROM "email_queue"
          WHERE "next_retry_at" <= NOW()
          ORDER BY "next_retry_at" ASC
          LIMIT ${this.BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `,
      )) as EmailQueueRow[];

      if (rows.length > 0) {
        await tx.emailQueue.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { nextRetryAt: new Date(Date.now() + this.CLAIM_LEASE_MS) },
        });
      }
      return rows;
    });

    let delivered = 0;
    let stillFailing = 0;
    let permanentFailures = 0;

    for (const job of batch) {
      try {
        // Decrypt at-rest payloads before handing them to the email provider.
        // A corrupt ciphertext (bad `v1:` prefix, GCM auth-tag mismatch after
        // a key rotation, truncated column) throws here — the per-row wrapper
        // keeps one poison row from stopping its siblings.
        const html = this.queue.decrypt(job.html);
        const text = job.text ? this.queue.decrypt(job.text) : undefined;
        const result = await this.email.send({
          to: job.to,
          subject: job.subject,
          html,
          text,
        });

        if (result.delivered) {
          await this.prisma.emailQueue.delete({ where: { id: job.id } });
          delivered++;
          continue;
        }

        const retryCount = job.retryCount + 1;
        // A permanent rejection will refuse identically on every retry, so it
        // is terminal now rather than after MAX_RETRIES of backoff.
        if (result.permanent || retryCount > this.MAX_RETRIES) {
          const recipientRef = privacyPseudonym(
            job.to.trim().toLowerCase(),
            'email-recipient',
          ).slice(0, 16);
          this.logger.warn(
            result.permanent
              ? `Permanently rejected queued email ${job.id} to ${recipientRef} (driver=${result.driver}) — not retrying; check sender domain verification`
              : `Giving up on queued email ${job.id} to ${recipientRef} after ${this.MAX_RETRIES} retries`,
          );
          // Keep the row with a terminal marker so ops can forensically
          // inspect why a dropped security email failed — deleting silently
          // loses that signal. Park the row out of the retry window until
          // the `expiresAt < now()` purge eventually removes it.
          await this.prisma.emailQueue.update({
            where: { id: job.id },
            data: {
              retryCount,
              nextRetryAt: new Date(Date.now() + this.PERMANENT_FAILURE_PARK_MS),
              lastError: this.PERMANENT_FAILURE_MARKER,
            },
          });
          permanentFailures++;
          continue;
        }

        const delayMs = Math.min(2 ** retryCount, 2 ** 8) * 60_000;
        await this.prisma.emailQueue.update({
          where: { id: job.id },
          data: {
            retryCount,
            nextRetryAt: new Date(Date.now() + delayMs),
            lastError: `delivery_failed (${result.driver})`,
          },
        });
        stillFailing++;
      } catch (err: unknown) {
        // Per-row isolation: a thrown decrypt()/send() must not stop the rest
        // of the batch. Mark the row a permanent failure and park it out of
        // the retry window; the batch continues.
        const recipientRef = privacyPseudonym(job.to.trim().toLowerCase(), 'email-recipient').slice(
          0,
          16,
        );
        this.logger.warn(
          `Dropping unprocessable queued email ${job.id} to ${recipientRef}: ${
            err instanceof Error ? err.name : 'UnknownError'
          }`,
        );
        try {
          await this.prisma.emailQueue.update({
            where: { id: job.id },
            data: {
              retryCount: job.retryCount + 1,
              nextRetryAt: new Date(Date.now() + this.PERMANENT_FAILURE_PARK_MS),
              lastError: this.PERMANENT_FAILURE_MARKER,
            },
          });
        } catch (parkErr: unknown) {
          // The row keeps its claim lease and comes back later; losing the
          // park must not abort the remaining rows.
          this.logger.error(
            `Failed to park unprocessable email ${job.id}: ${
              parkErr instanceof Error ? parkErr.name : 'UnknownError'
            }`,
          );
        }
        permanentFailures++;
      }
    }

    const processed = batch.length;

    if (processed > 0) {
      this.logger.log(
        `Email queue processed: ${processed} attempted, ${delivered} delivered, ${stillFailing} still failing, ${permanentFailures} dropped`,
      );
    }

    return { purged, processed, delivered, stillFailing, permanentFailures };
  }
}
