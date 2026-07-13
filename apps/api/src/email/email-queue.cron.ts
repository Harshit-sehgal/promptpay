import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { acquireCronLease } from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from './email.service';

/**
 * Processes queued transactional emails with exponential backoff.
 *
 * - Runs every minute via setInterval.
 * - Acquires a cross-replica cron lease.
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async onApplicationBootstrap() {
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

    const batch = await this.prisma.emailQueue.findMany({
      where: { nextRetryAt: { lte: new Date() } },
      orderBy: { nextRetryAt: 'asc' },
      take: this.BATCH_SIZE,
    });

    let delivered = 0;
    let stillFailing = 0;
    let permanentFailures = 0;

    for (const job of batch) {
      const result = await this.email.send({
        to: job.to,
        subject: job.subject,
        html: job.html,
        text: job.text ?? undefined,
      });

      if (result.delivered) {
        await this.prisma.emailQueue.delete({ where: { id: job.id } });
        delivered++;
        continue;
      }

      const retryCount = job.retryCount + 1;
      if (retryCount > this.MAX_RETRIES) {
        this.logger.warn(
          `Giving up on queued email to ${job.to} after ${this.MAX_RETRIES} retries`,
        );
        await this.prisma.emailQueue.delete({ where: { id: job.id } });
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
    }

    if (batch.length > 0) {
      this.logger.log(
        `Email queue processed: ${batch.length} attempted, ${delivered} delivered, ${stillFailing} still failing, ${permanentFailures} dropped`,
      );
    }

    return { purged, processed: batch.length, delivered, stillFailing, permanentFailures };
  }
}
