import * as bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { UserRole } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { FraudService } from '../fraud/fraud.service';
import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from './__fixtures__/test-keys';
import { TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2 } from './__fixtures__/test-keys-2';
import { AuthService } from './auth.service';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';
import { JwtStrategy } from './strategies/jwt.strategy';

const EMAIL = 'refresh-rotate@waitlayer.com';
const PASSWORD = 'Password123!';

describe('Auth refresh / JWT rotation (P1 #15)', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let jwt: JwtService;
  let strategy: JwtStrategy;
  let userId: string;

  beforeAll(async () => {
    process.env.JWT_PRIVATE_KEY = TEST_JWT_PRIVATE_KEY;
    process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY;
    delete process.env.JWT_PUBLIC_KEYS;

    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "users", "sessions" CASCADE;`);

    const config = new ConfigService();
    jwt = new JwtService({
      privateKey: TEST_JWT_PRIVATE_KEY,
      publicKey: TEST_JWT_PUBLIC_KEY,
      signOptions: { algorithm: 'RS256', expiresIn: '15m' },
      verifyOptions: { algorithms: ['RS256'] },
    });
    auth = new AuthService(
      prisma,
      jwt,
      config,
      // Mock collaborators: the rotation path only touches prisma + jwt +
      // config, so side-effect services are stubbed.
      { verify: vi.fn() } as unknown as GoogleTokenVerifier,
      { computeTrustScore: vi.fn().mockResolvedValue(40) } as unknown as FraudService,
      {
        sendEmailVerification: vi.fn(),
        sendPasswordReset: vi.fn(),
        sendPasswordChanged: vi.fn(),
      } as unknown as EmailQueueService,
      { log: vi.fn(), logStrict: vi.fn() } as unknown as AuditService,
    );
    strategy = new JwtStrategy(config, prisma);

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash,
        name: 'Refresh Rotation',
        role: UserRole.DEVELOPER,
        country: 'US',
        status: 'active',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "users", "sessions" CASCADE;`);
    await prisma.$disconnect();
  });

  function decode(token: string): Record<string, unknown> {
    return jwt.decode(token) as Record<string, unknown>;
  }

  it('(a) refresh with a valid refresh token returns a new access token', async () => {
    const { accessToken, refreshToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    const result = await auth.refresh(refreshToken);
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.accessToken.length).toBeGreaterThan(0);
    // A genuinely new access token is issued.
    expect(result.accessToken).not.toBe(accessToken);
  });

  it('(b) reusing the old (now-revoked) refresh token is rejected (401)', async () => {
    const { refreshToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    // First rotation consumes the presented refresh token.
    await auth.refresh(refreshToken);
    // Replaying the same refresh token must be refused.
    await expect(auth.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('(c) an invalid or expired refresh token is rejected (401)', async () => {
    // Malformed token (bad signature / not a JWT).
    await expect(auth.refresh('not-a-real-token')).rejects.toBeInstanceOf(UnauthorizedException);

    // Expired refresh token.
    const expired = await jwt.signAsync(
      {
        sub: userId,
        role: UserRole.DEVELOPER,
        family: 'f',
        jti: 'j-expired',
        iss: 'waitlayer',
        aud: ['waitlayer-client', 'refresh'],
      },
      { expiresIn: -10 },
    );
    await expect(auth.refresh(expired)).rejects.toBeInstanceOf(UnauthorizedException);

    // Token signed by an untrusted key pair.
    const rogueJwt = new JwtService({
      privateKey: TEST_JWT_PRIVATE_KEY_2,
      publicKey: TEST_JWT_PUBLIC_KEY_2,
      signOptions: { algorithm: 'RS256' },
      verifyOptions: { algorithms: ['RS256'] },
    });
    const rogue = await rogueJwt.signAsync(
      {
        sub: userId,
        role: UserRole.DEVELOPER,
        family: 'f',
        jti: 'j-rogue',
        iss: 'waitlayer',
        aud: ['waitlayer-client', 'refresh'],
      },
      { expiresIn: '30d' },
    );
    await expect(auth.refresh(rogue)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('(d) rotation invalidates the prior access token', async () => {
    const { accessToken, refreshToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    const oldJti = decode(accessToken).jti as string;
    // Prior access token is accepted by the guard before rotation.
    await expect(
      strategy.validate({
        sub: userId,
        role: UserRole.DEVELOPER,
        jti: oldJti,
        aud: ['waitlayer-client', 'access'],
      }),
    ).resolves.toBeDefined();

    // Rotate via the refresh token.
    await auth.refresh(refreshToken);

    // The previous access token's session is now revoked, so the guard rejects it.
    const session = await prisma.session.findUnique({ where: { id: oldJti } });
    expect(session?.revoked).toBe(true);
    await expect(
      strategy.validate({
        sub: userId,
        role: UserRole.DEVELOPER,
        jti: oldJti,
        aud: ['waitlayer-client', 'access'],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('exchanging a still-valid access JWT returns a fresh pair and consumes it', async () => {
    const { accessToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    const oldJti = decode(accessToken).jti as string;

    const result = await auth.refresh(accessToken);
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.accessToken).not.toBe(accessToken);

    // The presented access token's session is now revoked.
    const session = await prisma.session.findUnique({ where: { id: oldJti } });
    expect(session?.revoked).toBe(true);
    await expect(
      strategy.validate({
        sub: userId,
        role: UserRole.DEVELOPER,
        jti: oldJti,
        aud: ['waitlayer-client', 'access'],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Replaying the same access token is rejected (reuse / replay).
    await expect(auth.refresh(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with the wrong audience (401)', async () => {
    // A step-up token (audience "step-up", not "refresh"/"access") is not a
    // valid rotation credential.
    const wrongAud = await jwt.signAsync(
      {
        sub: userId,
        role: UserRole.DEVELOPER,
        jti: 'j-wrong-aud',
        iss: 'waitlayer',
        aud: ['waitlayer-client', 'step-up'],
      },
      { expiresIn: '30d' },
    );
    await expect(auth.refresh(wrongAud)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
