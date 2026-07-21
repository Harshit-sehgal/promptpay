import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

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

    // SELECT ... FOR UPDATE SKIP LOCKED only holds its row locks for the life
    // of the containing transaction — under autocommit the lock is released
    // the instant the SELECT returns, so two replicas could each select and
    // retry the same row. The per-row try/send/delete/update must run inside
    // ONE $transaction so the SKIP LOCKED lease stays held until every row in
    // the batch is resolved. The cron lease above prevents duplicate runs;
    // this transaction is the row-level duplicate-prevention barrier the
    // doc-comment relies on. The network send happens inside the tx by
    // design: the batch is small (BATCH_SIZE) and the alternative (duplicate
    // password-reset / verify emails sent twice) is worse than a slightly
    // longer-held lock.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const batch = (await tx.$queryRaw<EmailQueueRow[]>(
        Prisma.sql`
          SELECT * FROM "email_queue"
          WHERE "next_retry_at" <= NOW()
          ORDER BY "next_retry_at" ASC
          LIMIT ${this.BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `,
      )) as EmailQueueRow[];

      let delivered = 0;
      let stillFailing = 0;
      let permanentFailures = 0;

      for (const job of batch) {
        try {
          // Decrypt at-rest payloads before handing them to the email provider.
          // A corrupt ciphertext (bad `v1:` prefix, GCM auth-tag mismatch after
          // a key rotation, truncated column) throws here — wrap the whole
          // per-row block so one poison row cannot roll back the batch tx and
          // re-send the siblings that already succeeded this tick.
          const html = this.queue.decrypt(job.html);
          const text = job.text ? this.queue.decrypt(job.text) : undefined;
          const result = await this.email.send({
            to: job.to,
            subject: job.subject,
            html,
            text,
          });

          if (result.delivered) {
            await tx.emailQueue.delete({ where: { id: job.id } });
            delivered++;
            continue;
          }

          const retryCount = job.retryCount + 1;
          if (retryCount > this.MAX_RETRIES) {
            const recipientRef = privacyPseudonym(
              job.to.trim().toLowerCase(),
              'email-recipient',
            ).slice(0, 16);
            this.logger.warn(
              `Giving up on queued email ${job.id} to ${recipientRef} after ${this.MAX_RETRIES} retries`,
            );
            // Keep the row with a terminal marker so ops can forensically
            // inspect why a dropped security email failed — deleting silently
            // loses that signal. Park the row out of the retry window until
            // the `expiresAt < now()` purge eventually removes it.
            await tx.emailQueue.update({
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
          await tx.emailQueue.update({
            where: { id: job.id },
            data: {
              retryCount,
              nextRetryAt: new Date(Date.now() + delayMs),
              lastError: `delivery_failed (${result.driver})`,
            },
          });
          stillFailing++;
        } catch (err: unknown) {
          // Per-row isolation: a thrown decrypt()/send() must not abort the
          // batch transaction (which would roll back already-deleted rows and
          // cause them to be re-sent next tick). Mark the row a permanent
          // failure and park it out of the retry window; the batch continues.
          const recipientRef = privacyPseudonym(
            job.to.trim().toLowerCase(),
            'email-recipient',
          ).slice(0, 16);
          this.logger.warn(
            `Dropping unprocessable queued email ${job.id} to ${recipientRef}: ${
              err instanceof Error ? err.name : 'UnknownError'
            }`,
          );
          await tx.emailQueue.update({
            where: { id: job.id },
            data: {
              retryCount: job.retryCount + 1,
              nextRetryAt: new Date(Date.now() + this.PERMANENT_FAILURE_PARK_MS),
              lastError: this.PERMANENT_FAILURE_MARKER,
            },
          });
          permanentFailures++;
        }
      }

      return { processed: batch.length, delivered, stillFailing, permanentFailures };
    });

    const processed = outcome.processed;
    const delivered = outcome.delivered;
    const stillFailing = outcome.stillFailing;
    const permanentFailures = outcome.permanentFailures;

    if (processed > 0) {
      this.logger.log(
        `Email queue processed: ${processed} attempted, ${delivered} delivered, ${stillFailing} still failing, ${permanentFailures} dropped`,
      );
    }

    return { purged, processed, delivered, stillFailing, permanentFailures };
  }
}
