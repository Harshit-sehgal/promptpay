import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../config/prisma.service';
import { EmailMessage, EmailService } from './email.service';

/** Result of an attempted queue-backed email send. */
export interface EmailQueueSendResult {
  delivered: boolean;
}

/**
 * Queue-backed transactional email service.
 *
 * Wraps EmailService: it attempts immediate delivery first; if the provider
 * rejects or is unavailable, the rendered message is persisted to the
 * `EmailQueue` table and retried later by EmailQueueCron with exponential
 * backoff.
 *
 * Duplicate messages (same recipient, subject, html, and text) are coalesced
 * into a single pending row via a content-hash unique constraint, so a burst
 * of identical failed emails does not multiply queue depth. The existing retry
 * count is preserved to prevent an attacker from keeping a failing email in
 * the queue indefinitely by repeatedly triggering the same message.
 *
 * This keeps auth flows (verification, password reset) responsive even when
 * the email provider is down, and prevents silent loss of security-critical
 * emails.
 */
@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  /** Try to send immediately; queue for retry on failure. */
  async enqueueOrSend(msg: EmailMessage): Promise<EmailQueueSendResult> {
    const result = await this.email.send(msg);
    if (result.delivered) {
      return { delivered: true };
    }

    // Persist for retry. Use the message TTL to bound stale retries.
    const ttlMs = msg.ttlMs ?? 24 * 60 * 60 * 1000;
    const now = Date.now();
    const contentHash = this.hashContent(msg);
    const nextRetryAt = new Date(now + this.baseDelayMs(0));
    const expiresAt = new Date(now + ttlMs);

    try {
      const existing = await this.prisma.emailQueue.findUnique({
        where: { contentHash },
      });

      if (existing) {
        // Preserve the existing retry count so repeated duplicates cannot
        // reset the backoff clock and keep a failing message alive forever.
        const retryDelayMs = this.baseDelayMs(existing.retryCount);
        await this.prisma.emailQueue.update({
          where: { id: existing.id },
          data: {
            nextRetryAt:
              existing.nextRetryAt < new Date(now + retryDelayMs)
                ? existing.nextRetryAt
                : new Date(now + retryDelayMs),
            expiresAt: existing.expiresAt > expiresAt ? existing.expiresAt : expiresAt,
            lastError: null,
          },
        });
      } else {
        await this.prisma.emailQueue.create({
          data: {
            to: msg.to,
            subject: msg.subject,
            html: msg.html,
            text: msg.text ?? null,
            contentHash,
            nextRetryAt,
            expiresAt,
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to persist queued email for ${msg.to}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return { delivered: false };
  }

  async sendEmailVerification(to: string, token: string): Promise<EmailQueueSendResult> {
    return this.enqueueOrSend(this.email.buildEmailVerification(to, token));
  }

  async sendPasswordReset(to: string, token: string): Promise<EmailQueueSendResult> {
    return this.enqueueOrSend(this.email.buildPasswordReset(to, token));
  }

  async sendPasswordChanged(to: string): Promise<EmailQueueSendResult> {
    return this.enqueueOrSend(this.email.buildPasswordChanged(to));
  }

  async sendAccountDeleted(to: string): Promise<EmailQueueSendResult> {
    return this.enqueueOrSend(this.email.buildAccountDeleted(to));
  }

  /** SHA-256 of the normalized message content for deduplication. */
  private hashContent(msg: EmailMessage): string {
    const payload = `${msg.to.toLowerCase()}|${msg.subject}|${msg.html}|${msg.text ?? ''}`;
    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  /** Exponential backoff: 1min, 2min, 4min, 8min, 16min, 32min, 64min, 128min. */
  private baseDelayMs(retryCount: number): number {
    return Math.min(2 ** retryCount, 2 ** 8) * 60_000;
  }
}
