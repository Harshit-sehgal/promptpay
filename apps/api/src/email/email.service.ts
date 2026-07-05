import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSendResult {
  delivered: boolean;
  driver: string;
}

/**
 * Provider-agnostic transactional email service.
 *
 * Drivers (selected via EMAIL_DRIVER env):
 *  - `console` (default) — logs the message; no network calls. Safe for dev/test.
 *  - `resend`  — sends via the Resend HTTP API (requires RESEND_API_KEY).
 *
 * Sending is intentionally non-throwing: a transient email failure must never
 * fail the surrounding request. Callers get `{delivered}` and failures are logged.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly driver: string;
  private readonly from: string;
  private readonly webBaseUrl: string;
  private readonly resendApiKey: string;

  constructor(private config: ConfigService) {
    this.driver = this.config.get<string>('EMAIL_DRIVER', 'console');
    this.from = this.config.get<string>('EMAIL_FROM', 'WaitLayer <no-reply@waitlayer.dev>');
    this.webBaseUrl = this.config.get<string>('WEB_BASE_URL', 'http://localhost:3000');
    this.resendApiKey = this.config.get<string>('RESEND_API_KEY', '');

    if (this.driver === 'resend' && !this.resendApiKey) {
      this.logger.warn('EMAIL_DRIVER=resend but RESEND_API_KEY is not set — falling back to console driver');
      this.driver = 'console';
    }

    // Production fail-closed: the console driver logs full email bodies to
    // stdout/server-log aggregation. For password resets and email-verify
    // links this is an instant account-takeover vector — anyone with log
    // access would capture live reset tokens and verify any account. Refuse
    // to silently fall back to console-logging in a production deploy.
    //
    // Note: we do NOT consult `this.driver === 'console'` because the
    // resend-misconfigured branch above may have just downgraded us there.
    // The intent check is explicit: in production, only explicitly-non-console
    // drivers contribute password-reset/verify code flows.
    if (process.env.NODE_ENV === 'production' && this.driver === 'console') {
      throw new Error(
        'EMAIL_DRIVER=console is not allowed in production — it logs email bodies ' +
          '(including password-reset and email-verify tokens) to stdout. Set ' +
          'EMAIL_DRIVER=resend with RESEND_API_KEY, or EMAIL_DRIVER to another ' +
          'non-console transport.',
      );
    }
  }

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    // Final defensive check — even if a future misconfiguration slipped past
    // the constructor (e.g. ENV toggled at runtime via a test), never log a
    // production email body. Use delivered=false so callers can react.
    if (process.env.NODE_ENV === 'production' && this.driver === 'console') {
      this.logger.error(
        `Refusing to send production email via console driver to=${msg.to} subject="${msg.subject}". ` +
          'This would log password-reset/verify tokens to stdout.',
      );
      return { delivered: false, driver: 'console' };
    }
    try {
      switch (this.driver) {
        case 'resend':
          return await this.sendViaResend(msg);
        case 'console':
        default:
          this.logger.log(`[console email] to=${msg.to} subject="${msg.subject}"`);
          return { delivered: true, driver: 'console' };
      }
    } catch (err) {
      this.logger.error(`Email delivery failed (driver=${this.driver}, to=${msg.to}): ${(err as Error).message}`);
      return { delivered: false, driver: this.driver };
    }
  }

  /** Email verification link (24h token) */
  async sendEmailVerification(to: string, token: string): Promise<EmailSendResult> {
    const link = `${this.webBaseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
    return this.send({
      to,
      subject: 'Verify your WaitLayer email',
      text: `Verify your email address by opening this link (valid for 24 hours):\n\n${link}\n\nIf you did not create a WaitLayer account, you can ignore this email.`,
      html: this.layout(
        'Verify your email',
        `<p>Confirm this email address for your WaitLayer account. The link is valid for <strong>24 hours</strong>.</p>`,
        link,
        'Verify email',
        'If you did not create a WaitLayer account, you can safely ignore this email.',
      ),
    });
  }

  /** Password reset link (1h token) */
  async sendPasswordReset(to: string, token: string): Promise<EmailSendResult> {
    const link = `${this.webBaseUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;
    return this.send({
      to,
      subject: 'Reset your WaitLayer password',
      text: `Reset your WaitLayer password by opening this link (valid for 1 hour):\n\n${link}\n\nIf you did not request a password reset, you can ignore this email.`,
      html: this.layout(
        'Reset your password',
        `<p>We received a request to reset your WaitLayer password. The link is valid for <strong>1 hour</strong>.</p>`,
        link,
        'Reset password',
        'If you did not request a password reset, you can safely ignore this email — your password will not change.',
      ),
    });
  }

  /** Security notification after a successful password change */
  async sendPasswordChanged(to: string): Promise<EmailSendResult> {
    return this.send({
      to,
      subject: 'Your WaitLayer password was changed',
      text: 'Your WaitLayer password was just changed and all active sessions were signed out. If this was not you, reset your password immediately and contact support.',
      html: this.layout(
        'Password changed',
        `<p>Your WaitLayer password was just changed and all active sessions were signed out.</p>`,
        null,
        null,
        'If this was not you, reset your password immediately and contact support.',
      ),
    });
  }

  // ── Private ──

  private async sendViaResend(msg: EmailMessage): Promise<EmailSendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Resend API error ${res.status}: ${body.slice(0, 500)}`);
      return { delivered: false, driver: 'resend' };
    }
    return { delivered: true, driver: 'resend' };
  }

  /** Minimal, client-safe HTML layout shared by all transactional emails */
  private layout(
    title: string,
    bodyHtml: string,
    ctaUrl: string | null,
    ctaLabel: string | null,
    footer: string,
  ): string {
    const button =
      ctaUrl && ctaLabel
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:10px;background:#4f46e5;">
             <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${ctaLabel}</a>
           </td></tr></table>
           <p style="font-size:12px;color:#6b7280;word-break:break-all;">Or copy this link: ${ctaUrl}</p>`
        : '';

    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
          <tr><td>
            <p style="font-weight:700;font-size:15px;margin:0 0 24px;">WaitLayer</p>
            <h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
            <div style="font-size:14px;line-height:1.6;color:#374151;">${bodyHtml}</div>
            ${button}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
            <p style="font-size:12px;color:#9ca3af;margin:0;">${footer}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  }
}
