import * as bcrypt from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';
import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { Prisma } from '@waitlayer/db';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { TwoFactorSetupDto } from './dto';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';

const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BACKUP_CODE_COUNT = 10;

export class AuthTotpTrait {
  declare prisma: PrismaService;
  declare jwt: JwtService;
  declare config: ConfigService;
  declare audit: AuditService;
  declare logger: Logger;
  declare totpEncryptionKey: Buffer;
  declare googleVerifier: GoogleTokenVerifier;

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
  async setupTwoFactor(userId: string, proof: TwoFactorSetupDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.twoFactorEnabled) {
      throw new BadRequestException(
        'Disable two-factor authentication before setting up a new secret',
      );
    }
    let reauthenticated = false;
    if (user.passwordHash && proof.currentPassword) {
      reauthenticated = await bcrypt.compare(proof.currentPassword, user.passwordHash);
    }
    if (!reauthenticated && user.googleId && proof.googleIdToken) {
      const google = await this.googleVerifier.verify(proof.googleIdToken);
      reauthenticated =
        google.email_verified &&
        google.sub === user.googleId &&
        google.email.trim().toLowerCase() === user.email.trim().toLowerCase();
    }
    if (!reauthenticated) {
      throw new UnauthorizedException('Reauthentication is required before setting up 2FA');
    }
    const secret = generateTotpSecret();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { twoFactorSecret: this.encryptTotpSecret(secret) },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: 'two_factor_setup_started',
          targetType: 'user',
          targetId: userId,
        },
      });
    });
    return {
      secret,
      otpauthUrl: buildOtpAuthUrl(secret, user.email || userId),
    };
  }

  async enableTwoFactor(userId: string, token: string, currentJti?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Call setupTwoFactor before enabling 2FA');
    }
    const secret = this.decryptTotpSecret(user.twoFactorSecret);
    if (!secret || !verifyTotp(secret, token)) {
      throw new BadRequestException('Invalid or expired 2FA code');
    }
    const backupCodes = this.generateBackupCodes();
    const updateData: Prisma.UserUpdateInput = {
      twoFactorEnabled: true,
      twoFactorBackupCodeHashes: backupCodes.map((code) => this.hashBackupCode(code)),
    };
    if (!this.isEncryptedTotpSecret(user.twoFactorSecret)) {
      updateData.twoFactorSecret = this.encryptTotpSecret(secret);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: updateData });
      await tx.session.updateMany({
        where: { userId, ...(currentJti ? { id: { not: currentJti } } : {}) },
        data: { revoked: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: 'two_factor_enabled',
          targetType: 'user',
          targetId: userId,
        },
      });
    });
    return { twoFactorEnabled: true, backupCodes };
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
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodeHashes: [],
        },
      });
      await tx.session.updateMany({ where: { userId }, data: { revoked: true } });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: 'two_factor_disabled',
          targetType: 'user',
          targetId: userId,
        },
      });
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

  async assertTwoFactorSatisfied(
    user: {
      id: string;
      role: string;
      twoFactorEnabled?: boolean;
      twoFactorSecret?: string | null;
    },
    token?: string,
    backupCode?: string,
  ): Promise<void> {
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
    if (!token && !backupCode) {
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
    if (token && verifyTotp(secret, token)) return;
    if (backupCode && (await this.consumeBackupCode(user, backupCode))) return;
    {
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

  async regenerateTwoFactorBackupCodes(userId: string, token: string, currentJti?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }
    const secret = this.decryptTotpSecret(user.twoFactorSecret);
    if (!secret || !verifyTotp(secret, token)) {
      throw new UnauthorizedException('Invalid two-factor authentication code');
    }
    const backupCodes = this.generateBackupCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { twoFactorBackupCodeHashes: backupCodes.map((code) => this.hashBackupCode(code)) },
      });
      await tx.session.updateMany({
        where: { userId, ...(currentJti ? { id: { not: currentJti } } : {}) },
        data: { revoked: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: 'two_factor_backup_codes_regenerated',
          targetType: 'user',
          targetId: userId,
        },
      });
    });
    return { backupCodes };
  }

  generateBackupCodes(): string[] {
    return Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const chars = Array.from(randomBytes(12), (byte) => BACKUP_CODE_ALPHABET[byte & 31]);
      return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars
        .slice(8, 12)
        .join('')}`;
    });
  }

  hashBackupCode(code: string): string {
    return createHmac('sha256', this.totpEncryptionKey)
      .update(`waitlayer-2fa-backup-v1:${code.trim().toUpperCase()}`)
      .digest('hex');
  }

  async consumeBackupCode(
    user: { id: string; role: string },
    backupCode: string,
  ): Promise<boolean> {
    const hash = this.hashBackupCode(backupCode);
    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.$executeRaw`
        UPDATE "users"
           SET "two_factor_backup_code_hashes" = array_remove("two_factor_backup_code_hashes", ${hash})
         WHERE "id" = ${user.id}
           AND ${hash} = ANY("two_factor_backup_code_hashes")
      `;
      if (consumed !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'two_factor_backup_code_used',
          targetType: 'user',
          targetId: user.id,
        },
      });
      return true;
    });
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

  /** ── Action-Scoped MFA Step-Up ──
   *  Issues a short-lived RS256 token that proves the user recently supplied
   *  a valid TOTP (or backup code). The token is scoped to a single action
   *  (e.g., `payout:request`) and must be presented in the `x-step-up-token`
   *  header for the sensitive mutation.
   */
  async createStepUpToken(userId: string, action: string, token: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodeHashes: true,
      },
    });
    if (!user) throw new BadRequestException('User not found');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const secret = this.decryptTotpSecret(user.twoFactorSecret);
    if (!secret) {
      throw new UnauthorizedException('Two-factor authentication is misconfigured');
    }

    const verified = verifyTotp(secret, token) || (await this.consumeBackupCode(user, token));
    if (!verified) {
      throw new UnauthorizedException('Invalid two-factor authentication code');
    }

    const issuer = this.config.get<string>('JWT_ISSUER', 'waitlayer');
    const audience = this.config.get<string>('JWT_AUDIENCE', 'waitlayer-client');
    const stepUpToken = await this.jwt.signAsync(
      { sub: userId, action, aud: [audience, 'step-up'], iss: issuer },
      { expiresIn: '5m' },
    );

    await this.audit.log({
      actorId: userId,
      actorRole: user.role,
      action: 'step_up_issued',
      targetType: 'user',
      targetId: userId,
      afterSnap: { action },
    });

    return { stepUpToken, expiresIn: '5m' };
  }
}
