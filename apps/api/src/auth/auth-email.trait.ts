import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuditService } from '../audit/audit.service';
import { CURRENT_CONSENT_VERSIONS, SIGNUP_CONSENT_PURPOSES } from '../compliance/consent-versions';
import { PrismaService } from '../config/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { FraudService } from '../fraud/fraud.service';
import {
  EmailVerificationPayload,
  SignupConsentMethod,
  SignupConsentRecord,
  SignupConsentVersions,
} from './auth.constants';

export class AuthEmailTrait {
  declare prisma: PrismaService;
  declare jwt: JwtService;
  declare config: ConfigService;
  declare fraud: FraudService;
  declare email: EmailQueueService;
  declare audit: AuditService;
  declare jwtSecret: string;

  // ── Private Helpers ──
  resolveSignupConsentVersions(policyVersion?: string): SignupConsentVersions {
    const versions = Object.fromEntries(
      SIGNUP_CONSENT_PURPOSES.map((purpose) => [purpose, CURRENT_CONSENT_VERSIONS[purpose]]),
    ) as SignupConsentVersions;
    if (
      policyVersion &&
      Object.values(versions).some((requiredVersion) => policyVersion !== requiredVersion)
    ) {
      throw new BadRequestException(
        'Accepted policy version is out of date. Refresh the signup page and try again.',
      );
    }
    return versions;
  }

  logSignupConsents(
    user: {
      id: string;
      role: string;
    },
    consentRows: SignupConsentRecord[],
    method: SignupConsentMethod,
  ) {
    for (const consent of consentRows) {
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'consent_granted',
        targetType: 'consent',
        targetId: consent.id,
        afterSnap: { purpose: consent.purpose, version: consent.version, method },
      });
    }
  }

  parseTtlToMs(ttl: string): number {
    // Support compound durations like `1h30m` or `1d12h`, not just a single
    // `(\d+)([smhd])` unit. Each segment is summed; an unparseable token or
    // empty string falls back to the 30d default.
    if (!ttl) return 30 * 24 * 60 * 60 * 1000;
    const matches = ttl.match(/(\d+)([smhd])/g);
    if (!matches) return 30 * 24 * 60 * 60 * 1000;
    const unitMs: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    let total = 0;
    for (const segment of matches) {
      const value = parseInt(segment.slice(0, -1), 10);
      const unit = segment.slice(-1);
      total += value * unitMs[unit];
    }
    return total || 30 * 24 * 60 * 60 * 1000;
  }

  async requestEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }
    // Stateless token: contains userId, email, and action. Valid for 24 hours.
    // Use RS256 asymmetric signing so the verification token is signed with
    // the private key and verifiable with the public key. This closes the
    // security gap where a shared JWT_SECRET compromise could forge email-
    // verification tokens.
    const issuer = this.config.get<string>('JWT_ISSUER', 'waitlayer');
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        action: 'email-verification',
        iss: issuer,
        aud: 'email-verification',
      },
      {
        algorithm: 'RS256',
        expiresIn: '24h',
      },
    );
    const result = await this.email.sendEmailVerification(user.email, token);
    if (!result.delivered) {
      // Email provider is down — don't tell the user the message was sent.
      // Ops can match audit.log entries to provider outages. The token is
      // valid for 24h; the user can retry when the provider recovers.
      return { message: 'Email delivery temporarily unavailable; please try again shortly' };
    }
    // Fail-closed: expose the raw token only when explicitly in dev/test.
    // Anything other than 'development' | 'test' (including unset, 'staging',
    // 'production') returns a generic success only — never the token.
    const nodeEnv = this.config.get<string>('NODE_ENV');
    const expose = nodeEnv === 'development' || nodeEnv === 'test';
    return {
      message: 'Verification email sent',
      ...(expose ? { token } : {}),
    };
  }

  async confirmEmailVerification(token: string) {
    let payload: EmailVerificationPayload;
    try {
      // Verify with RS256 using the public key (asymmetric verification).
      payload = await this.jwt.verifyAsync(token, {
        algorithms: ['RS256'],
        issuer: this.config.get<string>('JWT_ISSUER', 'waitlayer'),
        audience: 'email-verification',
      });
    } catch {
      throw new BadRequestException('Invalid or expired verification token');
    }
    if (payload.action !== 'email-verification') {
      throw new BadRequestException('Invalid token action');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('User not found');
    if (user.emailVerified) {
      return { message: 'Email is already verified', email: user.email };
    }
    // Bind the token to the user's CURRENT email. Tokens are minted
    // with `email: user.email` at request time. If the account's email
    // ever changes between request and confirm, the stale token must
    // NOT verify the new email — otherwise an attacker who intercepts
    // (or replays) an outstanding token could silently attach their
    // own email to the account. No email-change endpoint exists today,
    // but this is defense-in-depth so adding one in the future
    // automatically preserves the binding.
    if (payload.email !== user.email) {
      throw new BadRequestException(
        'Verification token does not match the current email on this account — please request a fresh verification email',
      );
    }
    // Update user to verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    // Recompute trust score to account for email verification (+10 points)
    await this.fraud.computeTrustScore(user.id); // Audit: email verified — key identity signal
    void this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'email_verified',
      targetType: 'user',
      targetId: user.id,
    });
    return {
      message: 'Email verified successfully',
      email: user.email,
    };
  }
}
