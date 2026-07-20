import * as bcrypt from 'bcryptjs';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { StringValue } from 'ms';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { SIGNUP_CONSENT_PURPOSES } from '../compliance/consent-versions';
import { PrismaService } from '../config/prisma.service';
import {
  AccessTokenPayload,
  audienceIncludes,
  SignupConsentMethod,
  SignupConsentRecord,
  SignupConsentVersions,
} from './auth.constants';
import { AuthEmailTrait } from './auth-email.trait';

export class AuthSessionTrait {
  declare prisma: PrismaService;
  declare jwt: JwtService;
  declare accessTtl: StringValue;
  declare refreshTtl: StringValue;
  declare audit: AuditService;
  declare jwtSecret: string;
  declare publicKey: string;

  async createSignupConsentRecords(
    tx: Prisma.TransactionClient,
    user: {
      id: string;
    },
    method: SignupConsentMethod,
    versions: SignupConsentVersions,
  ): Promise<SignupConsentRecord[]> {
    return Promise.all(
      SIGNUP_CONSENT_PURPOSES.map((purpose) =>
        tx.consent.create({
          data: {
            userId: user.id,
            purpose,
            version: versions[purpose],
            granted: true,
            metadata: { method },
          },
          select: {
            id: true,
            purpose: true,
            version: true,
          },
        }),
      ),
    );
  }

  async generateTokenPair(
    userId: string,
    role: string,
    existingFamily?: string,
    mfaAt?: number,
    tx?: Prisma.TransactionClient,
  ) {
    const family = existingFamily || randomUUID();
    // Pre-generate a session ID to use as jti in the access token
    const jti = randomUUID();
    const audience = this.config.get<string>('JWT_AUDIENCE', 'waitlayer-client');
    const issuer = this.config.get<string>('JWT_ISSUER', 'waitlayer');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        {
          sub: userId,
          role,
          jti,
          iss: issuer,
          aud: [audience, 'access'],
          mfaAt,
        } as AccessTokenPayload,
        { expiresIn: this.accessTtl },
      ),
      this.jwt.signAsync(
        { sub: userId, role, family, jti, iss: issuer, aud: [audience, 'refresh'], mfaAt },
        { expiresIn: this.refreshTtl },
      ),
    ]);
    // Store session with token family for rotation tracking
    const refreshHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.parseTtlToMs(this.refreshTtl));
    await (tx ?? this.prisma).session.create({
      data: {
        id: jti,
        userId,
        tokenHash: refreshHash,
        tokenFamily: family,
        expiresAt,
      },
    });
    return { accessToken, refreshToken };
  }

  hashRefreshToken(refreshToken: string): string {
    return `v2:${createHmac('sha256', this.jwtSecret)
      .update(`waitlayer-refresh-token-v2:${refreshToken}`)
      .digest('hex')}`;
  }

  async verifyRefreshTokenHash(refreshToken: string, storedHash: string): Promise<boolean> {
    if (storedHash.startsWith('v2:')) {
      const expected = Buffer.from(this.hashRefreshToken(refreshToken));
      const actual = Buffer.from(storedHash);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    }
    // Rolling compatibility: verify pre-v2 bcrypt rows once, then successful
    // rotation stores only the full-token keyed HMAC format.
    return storedHash.startsWith('$2') && bcrypt.compare(refreshToken, storedHash);
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId },
      data: { revoked: true },
    });
  }

  async logoutByRefreshToken(refreshToken: string) {
    let payload: { sub?: string; jti?: string; aud?: string | string[] };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.publicKey,
        algorithms: ['RS256'],
        issuer: this.config.get<string>('JWT_ISSUER', 'waitlayer'),
        audience: this.config.get<string>('JWT_AUDIENCE', 'waitlayer-client'),
        // Expiration is enforced: a stale or expired refresh token cannot be
        // used to perform a logout, matching the refresh endpoint's contract.
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!audienceIncludes(payload.aud, 'refresh') || !payload.sub || !payload.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { role: true },
    });
    await this.prisma.$transaction(async (tx) => {
      // Fail-closed: only revoke a session that exists and is not already
      // revoked. A missing or already-revoked session means the token is
      // stale/replayed and must be rejected.
      const result = await tx.session.updateMany({
        where: { id: payload.jti!, userId: payload.sub, revoked: false },
        data: { revoked: true },
      });
      if (result.count === 0) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      await tx.auditLog.create({
        data: {
          actorId: payload.sub!,
          actorRole: user?.role ?? 'unknown',
          action: 'logout',
          targetType: 'session',
          targetId: payload.jti!,
        },
      });
    });
    return { loggedOut: true };
  }

  async listSessions(userId: string, currentJti?: string) {
    const rows = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, createdAt: true, expiresAt: true, revoked: true },
    });
    return rows.map((row) => ({ ...row, isCurrent: row.id === currentJti }));
  }

  async revokeOtherSessions(userId: string, currentJti: string, actorRole: string) {
    const revoked = await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { userId, id: { not: currentJti }, revoked: false },
        data: { revoked: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole,
          action: 'sessions_revoked_others',
          targetType: 'session',
          targetId: userId,
          afterSnap: { count: result.count },
        },
      });
      return result.count;
    });
    return { revoked };
  }

  async revokeSession(userId: string, sessionId: string, actorRole: string) {
    const revoked = await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sessionId, userId, revoked: false },
        data: { revoked: true },
      });
      if (result.count !== 1) throw new NotFoundException('Session not found');
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole,
          action: 'session_revoked',
          targetType: 'session',
          targetId: sessionId,
        },
      });
      return result.count;
    });
    return { revoked: revoked === 1 };
  }

  sanitizeUser<
    T extends {
      passwordHash?: unknown;
      twoFactorSecret?: unknown;
    },
  >(user: T): Omit<T, 'passwordHash' | 'twoFactorSecret' | 'googleId' | 'githubId'> {
    const {
      passwordHash: _passwordHash,
      twoFactorSecret: _twoFactorSecret,
      googleId: _googleId,
      githubId: _githubId,
      ...safe
    } = user as T & {
      googleId?: unknown;
      githubId?: unknown;
    };
    return safe;
  }

  /** Generate a unique 8-char alphanumeric referral code (uppercase + digits) */
  async generateReferralCode(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = 8;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from(randomBytes(length))
        .map((b) => chars[b % chars.length])
        .join('');
      const exists = await this.prisma.user.findUnique({
        where: { referralCode: code },
      });
      if (!exists) return code;
    }
    // Fallback: append random suffix to avoid infinite loop
    const base = Array.from(randomBytes(6))
      .map((b) => chars[b % chars.length])
      .join('');
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    return `${base}${suffix}`;
  }
}
export interface AuthSessionTrait extends AuthEmailTrait {}
