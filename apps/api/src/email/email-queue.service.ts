import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { privacyPseudonym } from '../common/utils/privacy-hash';
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
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret = this.config.get<string>('EMAIL_QUEUE_SECRET');
    if (secret && secret.length >= 32) {
      this.encryptionKey = createHash('sha256').update(secret).digest();
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'EMAIL_QUEUE_SECRET is required in production and must be at least 32 characters to encrypt queued email payloads.',
      );
    } else {
      // Dev/test deterministic fallback so local tests pass without env churn.
      this.encryptionKey = createHash('sha256')
        .update('waitlayer-dev-email-queue-secret-32-bytes-min')
        .digest();
    }
  }

  /** Try to send immediately; queue for retry on failure. */
  async enqueueOrSend(msg: EmailMessage): Promise<EmailQueueSendResult> {
    const result = await this.email.send(msg);
    if (result.delivered) {
      return { delivered: true };
    }

    // Persist for retry. Use the message TTL to bound stale retries.
    const ttlMs = msg.ttlMs ?? 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Hash the plaintext so duplicate detection works regardless of encryption.
    const contentHash = this.hashContent(msg);
    const nextRetryAt = new Date(now + this.baseDelayMs(0));
    const expiresAt = new Date(now + ttlMs);

    try {
      const existing = await this.prisma.emailQueue.findUnique({
        where: { contentHash },
      });

      // Encrypt sensitive payloads at rest so a database-only leak does not
      // expose password-reset or email-verify tokens.
      const encryptedHtml = this.encrypt(msg.html);
      const encryptedText = msg.text ? this.encrypt(msg.text) : null;

      if (existing) {
        // Preserve the existing retry count so repeated duplicates cannot
        // reset the backoff clock and keep a failing message alive forever.
        const retryDelayMs = this.baseDelayMs(existing.retryCount);
        await this.prisma.emailQueue.update({
          where: { id: existing.id },
          data: {
            html: encryptedHtml,
            text: encryptedText,
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
            html: encryptedHtml,
            text: encryptedText,
            contentHash,
            nextRetryAt,
            expiresAt,
          },
        });
      }

      // The message is durably queued and will be retried by EmailQueueCron.
      return { delivered: true };
    } catch (err) {
      const recipientRef = privacyPseudonym(msg.to.trim().toLowerCase(), 'email-recipient').slice(
        0,
        16,
      );
      this.logger.error(
        `Failed to persist queued email for ${recipientRef}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return { delivered: false };
    }
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

  async sendPayoutAccountFrozenAlert(
    to: string,
    metadata: {
      provider: string;
      destination: string;
      currency: string;
      actorRole: string;
      reason?: string | null;
      time: string;
    },
  ): Promise<EmailQueueSendResult> {
    return this.enqueueOrSend(
      this.email.buildPayoutAccountFrozenAlert(to, {
        provider: metadata.provider,
        destination: metadata.destination,
        currency: metadata.currency,
        actorRole: metadata.actorRole,
        reason: metadata.reason ?? null,
        time: metadata.time,
      }),
    );
  }

  /**
   * Operator alert for money-integrity reconciliation drift. Best-effort
   * (fire-and-forget by callers) so a Resend outage never blocks the cron.
   */
  async sendMoneyIntegrityAlert(
    to: string,
    metadata: {
      severity: 'high' | 'medium';
      time: string;
      globalDiscrepancyByCurrency: Record<string, string>;
      campaignDiscrepancyCount: number;
      negativeDeveloperBalanceCount: number;
    },
  ): Promise<EmailQueueSendResult> {
    return this.enqueueOrSend(this.email.buildMoneyIntegrityAlert(to, metadata));
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

  /** Encrypt a queued payload using AES-256-GCM. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /** Decrypt a queued payload encrypted with {@link encrypt}. */
  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith('v1:')) {
      // Rollout compatibility: legacy plaintext rows decrypt to themselves.
      return ciphertext;
    }
    const [, ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !dataHex) {
      throw new Error('Malformed encrypted email payload');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
