import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma } from '@waitlayer/db';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';

export class AuthTotpTrait {
  declare prisma: PrismaService;
  declare config: ConfigService;
  declare audit: AuditService;
  declare logger: Logger;
  declare totpEncryptionKey: Buffer;

  /** ── Two-Factor Authentication (TOTP) ──
   *  Enrollment is a two-step flow:
   *    1. `setupTwoFactor` mints a secret and stores it (twoFactorEnabled stays
   *       false). The client renders the otpauth URL as a QR code.
   *    2. `enableTwoFactor` verifies a code against the stored secret, then
   *       flips twoFactorEnabled to true. Rotation requires disabling with a
   *       current code before setting up a replacement secret.
   *  Disabling requires a valid current code (step-up) to prevent an attacker
   *  who has taken over a session from silently turning MFA off.
   */
  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.twoFactorEnabled) {
      throw new BadRequestException(
        'Disable two-factor authentication before setting up a new secret',
      );
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: this.encryptTotpSecret(secret) },
    });
    return {
      secret,
      otpauthUrl: buildOtpAuthUrl(secret, user.email || userId),
    };
  }

  async enableTwoFactor(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Call setupTwoFactor before enabling 2FA');
    }
    const secret = this.decryptTotpSecret(user.twoFactorSecret);
    if (!secret || !verifyTotp(secret, token)) {
      throw new BadRequestException('Invalid or expired 2FA code');
    }
    const updateData: Prisma.UserUpdateInput = { twoFactorEnabled: true };
    if (!this.isEncryptedTotpSecret(user.twoFactorSecret)) {
      updateData.twoFactorSecret = this.encryptTotpSecret(secret);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
    void this.audit.log({
      actorId: userId,
      actorRole: user.role,
      action: 'two_factor_enabled',
      targetType: 'user',
      targetId: userId,
    });
    return { twoFactorEnabled: true };
  }

  async disableTwoFactor(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      // Already disabled — idempotent success.
      return { twoFactorEnabled: false };
    }
    const secret = this.decryptTotpSecret(user.twoFactorSecret);
    if (!secret || !verifyTotp(secret, token)) {
      throw new BadRequestException('Invalid or expired 2FA code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    void this.audit.log({
      actorId: userId,
      actorRole: user.role,
      action: 'two_factor_disabled',
      targetType: 'user',
      targetId: userId,
    });
    return { twoFactorEnabled: false };
  }

  /** Stable fingerprint of the current password hash (or its absence) */
  passwordFingerprint(passwordHash: string | null): string {
    return createHash('sha256')
      .update(passwordHash ?? 'no-password')
      .digest('hex')
      .slice(0, 16);
  }

  assertTwoFactorSatisfied(
    user: {
      id: string;
      role: string;
      twoFactorEnabled?: boolean;
      twoFactorSecret?: string | null;
    },
    token?: string,
  ) {
    if (!user.twoFactorEnabled) return;
    const secret = user.twoFactorSecret ? this.decryptTotpSecret(user.twoFactorSecret) : null;
    if (!secret) {
      // TOTP was enabled but the encrypted secret is missing/unrecoverable
      // (e.g. key rotation). Treat as a hard failure — never bypass 2FA.
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_failed',
        targetType: 'user',
        targetId: user.id,
        afterSnap: { reason: '2fa_secret_missing' },
      });
      throw new UnauthorizedException('Two-factor authentication is required but misconfigured');
    }
    // No token supplied yet → emit a structured 2FA challenge so clients
    // (web, CLI, VS Code) can prompt for the code and resubmit, rather than
    // returning the same generic "invalid credentials" as a bad password.
    if (!token) {
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_2fa_challenge',
        targetType: 'user',
        targetId: user.id,
      });
      throw new UnauthorizedException({
        message: 'Two-factor authentication code required',
        twoFactorRequired: true,
      });
    }
    if (!verifyTotp(secret, token)) {
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_failed',
        targetType: 'user',
        targetId: user.id,
        afterSnap: { reason: 'bad_2fa' },
      });
      throw new UnauthorizedException('Invalid two-factor authentication code');
    }
  }

  buildTotpEncryptionKey(): Buffer {
    const configured = this.config.get<string>('TOTP_SECRET_ENCRYPTION_KEY', '');
    if (configured && configured.length >= 32) {
      return createHash('sha256').update(configured).digest();
    }
    if (this.config.get<string>('NODE_ENV', 'development') === 'production') {
      throw new Error(
        'TOTP_SECRET_ENCRYPTION_KEY must be set to a 32+ character secret in production.',
      );
    }
    this.logger.warn(
      'TOTP_SECRET_ENCRYPTION_KEY is not set or too short. Using a stable development/test fallback key. Do NOT run this in production!',
    );
    return createHash('sha256')
      .update('stable-development-totp-encryption-fallback-key-32-chars')
      .digest();
  }

  isEncryptedTotpSecret(value: string): boolean {
    return value.startsWith('v1:');
  }

  encryptTotpSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.totpEncryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decryptTotpSecret(stored: string): string | null {
    if (!this.isEncryptedTotpSecret(stored)) {
      return stored;
    }
    const [, ivRaw, tagRaw, encryptedRaw] = stored.split(':');
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.totpEncryptionKey,
        Buffer.from(ivRaw, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
