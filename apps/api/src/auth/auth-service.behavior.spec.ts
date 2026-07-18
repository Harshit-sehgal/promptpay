import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from './__fixtures__/test-keys';
import { AuthService } from './auth.service';

/**
 * Behavioral regression tests for the decomposed AuthService (P1 #19 follow-up).
 *
 * The AuthService facade is composed from five traits at module load time:
 * AuthCoreTrait, AuthEmailTrait, AuthTotpTrait, AuthPasswordTrait, and
 * AuthSessionTrait. These tests verify that the composition is not merely
 * structural (method presence) but behavioral: cross-trait calls via `this`
 * work at runtime, the logger field is available before the constructor
 * body runs (regression for the TOTP dev-fallback crash), and a full signup
 * flow exercises methods from multiple traits.
 */

describe('AuthService behavioral composition', () => {
  let mockPrisma: any;

  const makeMockPrisma = () => {
    const prisma: any = {};
    prisma.$transaction = vi.fn((cb: any) => cb(prisma));
    prisma.$queryRaw = vi.fn().mockResolvedValue([]);
    prisma.$executeRaw = vi.fn().mockResolvedValue([]);
    prisma.user = {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    };
    prisma.userSettings = { create: vi.fn() };
    prisma.trustScore = { create: vi.fn() };
    prisma.advertiser = { create: vi.fn() };
    prisma.referral = { create: vi.fn() };
    prisma.consent = { create: vi.fn().mockResolvedValue({}) };
    prisma.session = {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    };
    prisma.auditLog = { create: vi.fn().mockResolvedValue({}) };
    return prisma;
  };

  const makeService = () => {
    const jwt = new JwtService({
      privateKey: TEST_JWT_PRIVATE_KEY,
      publicKey: TEST_JWT_PUBLIC_KEY,
      signOptions: { algorithm: 'RS256', expiresIn: '15m' },
      verifyOptions: { algorithms: ['RS256'] },
    });
    const config = {
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'JWT_SECRET') return 'test-secret-at-least-32-characters-long';
        if (key === 'JWT_PRIVATE_KEY') return TEST_JWT_PRIVATE_KEY;
        if (key === 'JWT_PUBLIC_KEY') return TEST_JWT_PUBLIC_KEY;
        if (key === 'JWT_ACCESS_TTL') return '15m';
        if (key === 'JWT_REFRESH_TTL') return '30d';
        if (key === 'NODE_ENV') return 'test';
        if (key === 'TOTP_SECRET_ENCRYPTION_KEY') return '';
        return fallback ?? null;
      }),
    } as unknown as ConfigService;

    return {
      service: new AuthService(
        mockPrisma,
        jwt,
        config,
        { verify: vi.fn() } as any,
        { computeTrustScore: vi.fn().mockResolvedValue(undefined) } as any,
        {
          sendEmailVerification: vi.fn().mockResolvedValue({ delivered: true }),
          sendPasswordReset: vi.fn().mockResolvedValue({ delivered: true }),
          sendPasswordChanged: vi.fn().mockResolvedValue({ delivered: true }),
        } as any,
        {
          log: vi.fn().mockResolvedValue(undefined),
          logStrict: vi.fn().mockResolvedValue(undefined),
        } as any,
      ),
      jwt,
    };
  };

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
  });

  it('has a concrete logger field before the constructor body runs', () => {
    // Regression: AuthTotpTrait.buildTotpEncryptionKey reaches
    // `this.logger.warn(...)` on the dev-fallback path. If the logger field
    // were not initialized before the constructor body, construction would
    // throw. The service must instantiate without a configured TOTP key.
    expect(() => makeService()).not.toThrow();
  });

  it('verifies issued access tokens contain the expected claims', async () => {
    const { service, jwt } = makeService();
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('mypassword', 12);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u-2',
      email: 'ok@test.com',
      role: 'developer',
      status: 'active',
      passwordHash,
      twoFactorEnabled: false,
    });
    mockPrisma.session.create.mockResolvedValue({ id: 's-2' });

    const result = await service.login({ email: 'ok@test.com', password: 'mypassword' });

    const payload = jwt.verify(result.accessToken, {
      algorithms: ['RS256'],
      issuer: 'waitlayer',
      audience: 'waitlayer-client',
    }) as any;
    expect(payload.sub).toBe('u-2');
    expect(payload.role).toBe('developer');
    expect(payload.aud).toContain('access');
  });

  it('signUp calls cross-trait consent helpers and issues tokens', async () => {
    const { service } = makeService();

    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'u-1',
      email: 'dev@test.com',
      role: 'developer',
      status: 'active',
      passwordHash: 'hash',
    });
    mockPrisma.consent.create.mockResolvedValue({ id: 'c-1' });
    mockPrisma.session.create.mockResolvedValue({ id: 's-1' });

    const result = await service.signUp({
      email: 'dev@test.com',
      password: 'password123',
      role: 'developer' as any,
      ageConfirmed: true,
      termsAccepted: true,
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user.email).toBe('dev@test.com');
    // Cross-trait call: AuthCoreTrait.signUp delegates consent creation to
    // AuthSessionTrait.createSignupConsentRecords via `this`.
    expect(mockPrisma.consent.create).toHaveBeenCalled();
  });

  it('login issues tokens and delegates session creation', async () => {
    const { service } = makeService();
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('mypassword', 12);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u-2',
      email: 'ok@test.com',
      role: 'developer',
      status: 'active',
      passwordHash,
      twoFactorEnabled: false,
    });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.session.create.mockResolvedValue({ id: 's-2' });

    const result = await service.login({ email: 'ok@test.com', password: 'mypassword' });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockPrisma.session.create).toHaveBeenCalled();
  });

  it('refresh rotates tokens and revokes the old session', async () => {
    const { service, jwt } = makeService();

    const refreshToken = await jwt.signAsync(
      {
        sub: 'u-2',
        role: 'developer',
        family: 'family-1',
        jti: 's-2',
        aud: ['waitlayer-client', 'refresh'],
      },
      { expiresIn: '30d', issuer: 'waitlayer' },
    );

    // Use the same v2 HMAC the service uses so the test does not depend on
    // the rolling bcrypt compatibility path.
    const { createHmac } = await import('crypto');
    const tokenHash = `v2:${createHmac('sha256', 'test-secret-at-least-32-characters-long')
      .update(`waitlayer-refresh-token-v2:${refreshToken}`)
      .digest('hex')}`;

    mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's-2',
      userId: 'u-2',
      tokenFamily: 'family-1',
      tokenHash,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u-2',
      role: 'developer',
      status: 'active',
    });
    mockPrisma.session.create.mockResolvedValue({ id: 's-3' });

    const result = await service.refresh(refreshToken);

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 's-2' }) }),
    );
    expect(mockPrisma.session.create).toHaveBeenCalled();
  });
});
