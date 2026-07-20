import * as bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const EMAIL = 'logout-test@waitlayer.com';
const PASSWORD = 'Password123!';

describe('Auth logout contracts (P0.3)', () => {
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
        name: 'Logout Test',
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

  it('POST /auth/logout revokes the current access-token session (jti)', async () => {
    const { accessToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    const jti = decode(accessToken).jti as string;

    await auth.logout(userId, jti);

    const session = await prisma.session.findUnique({ where: { id: jti } });
    expect(session?.revoked).toBe(true);
    await expect(
      strategy.validate({
        sub: userId,
        role: UserRole.DEVELOPER,
        jti,
        aud: ['waitlayer-client', 'access'],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('POST /auth/logout/refresh revokes the refresh-token session', async () => {
    const { refreshToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    const payload = jwt.decode(refreshToken) as { jti: string };

    await auth.logoutByRefreshToken(refreshToken);

    const session = await prisma.session.findUnique({ where: { id: payload.jti } });
    expect(session?.revoked).toBe(true);
  });

  it('rejects a revoked access token at /auth/logout', async () => {
    const { accessToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    const jti = decode(accessToken).jti as string;
    await auth.logout(userId, jti);

    // Replaying the same access token to /auth/logout should fail because the
    // session is already revoked. The guard rejects it before the service
    // method is reached.
    await expect(
      strategy.validate({
        sub: userId,
        role: UserRole.DEVELOPER,
        jti,
        aud: ['waitlayer-client', 'access'],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired refresh token at /auth/logout/refresh', async () => {
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

    await expect(auth.logoutByRefreshToken(expired)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed refresh token at /auth/logout/refresh', async () => {
    await expect(auth.logoutByRefreshToken('not-a-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an already-revoked refresh token at /auth/logout/refresh', async () => {
    const { refreshToken } = await auth.generateTokenPair(userId, UserRole.DEVELOPER);
    await auth.logoutByRefreshToken(refreshToken);

    // Replaying the same revoked refresh token must be rejected.
    await expect(auth.logoutByRefreshToken(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a refresh token signed by an untrusted key at /auth/logout/refresh', async () => {
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

    await expect(auth.logoutByRefreshToken(rogue)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
