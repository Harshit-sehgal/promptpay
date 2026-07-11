import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { StringValue } from 'ms';
import { JwtService } from '@nestjs/jwt';

import { Prisma } from '@waitlayer/db';

import { SIGNUP_CONSENT_PURPOSES } from '../compliance/consent-versions';
import { PrismaService } from '../config/prisma.service';
import {
  AccessTokenPayload,
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

  async generateTokenPair(userId: string, role: string, existingFamily?: string) {
    const family = existingFamily || randomUUID();
    // Pre-generate a session ID to use as jti in the access token
    const jti = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, role, jti, aud: 'access' } satisfies AccessTokenPayload & {
          aud: string;
        },
        { expiresIn: this.accessTtl },
      ),
      this.jwt.signAsync(
        { sub: userId, role, family, jti, aud: 'refresh' },
        { expiresIn: this.refreshTtl },
      ),
    ]);
    // Store session with token family for rotation tracking
    const refreshHash = await bcrypt.hash(refreshToken, 4);
    const expiresAt = new Date(Date.now() + this.parseTtlToMs(this.refreshTtl));
    await this.prisma.session.create({
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

  async revokeAllSessions(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId },
      data: { revoked: true },
    });
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
