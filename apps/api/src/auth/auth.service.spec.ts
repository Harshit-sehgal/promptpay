import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ConflictException } from '@nestjs/common';

// ── Prisma mock ──
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  userSettings: { create: vi.fn() },
  trustScore: { create: vi.fn() },
  advertiser: { create: vi.fn() },
  referral: { create: vi.fn() },
  session: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
};
const prismaRef = mockPrisma as any;

function makeService(overrides?: Record<string, string>) {
  const secret = overrides?.JWT_SECRET ?? 'test-secret-at-least-32-characters-long';
  const jwt = new JwtService({
    secret,
    signOptions: { expiresIn: '15m' },
  });
  const config = {
    get: vi.fn((key: string, fallback?: string) => {
      if (key === 'JWT_SECRET') return secret;
      if (key === 'JWT_ACCESS_TTL') return '15m';
      if (key === 'JWT_REFRESH_TTL') return '30d';
      return fallback ?? null;
    }),
  } as unknown as ConfigService;

  return {
    service: new AuthService(prismaRef, jwt, config),
    jwt,
    config,
    createAccessToken: (sub: string, role: string, ttl = '15m') =>
      jwt.signAsync({ sub, role }, { expiresIn: ttl } as any),
    createRefreshToken: (sub: string, role: string, family: string, ttl = '30d') =>
      jwt.signAsync({ sub, role, family }, { expiresIn: ttl } as any),
  };
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor — JWT secret validation', () => {
    it('rejects JWT_SECRET shorter than 32 characters', () => {
      expect(
        () => makeService({ JWT_SECRET: 'too-short' }),
      ).toThrow('JWT_SECRET must be defined and at least 32 characters');
    });

    it('accepts JWT_SECRET of 32+ characters', () => {
      expect(() => makeService()).not.toThrow();
    });
  });

  describe('signUp', () => {
    it('creates a new user and returns token pair', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u-1',
        email: 'dev@test.com',
        role: 'developer',
        status: 'active',
        passwordHash: '$2a$12$hash',
      });
      // referral code update after creation
      mockPrisma.user.update.mockResolvedValue({
        id: 'u-1',
        email: 'dev@test.com',
        role: 'developer',
        status: 'active',
        passwordHash: '$2a$12$hash',
        referralCode: 'ABCD1234',
      });

      const result = await service.signUp({
        email: 'dev@test.com',
        password: 'password123',
        role: 'developer' as any,
      });
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('dev@test.com');
      expect(mockPrisma.userSettings.create).toHaveBeenCalled();
      expect(mockPrisma.trustScore.create).toHaveBeenCalled();
      expect(mockPrisma.session.create).toHaveBeenCalled();
    });

    it('throws ConflictException for duplicate email', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'exists', email: 'a@b.com' });
      await expect(
        service.signUp({ email: 'a@b.com', password: 'pw', role: 'developer' as any }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException if user not found', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'x@x.com', password: 'pw' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns tokens on valid credentials', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-2',
        email: 'ok@test.com',
        role: 'developer',
        status: 'active',
        passwordHash: await (await import('bcryptjs')).hash('mypassword', 12),
      });
      const result = await service.login({ email: 'ok@test.com', password: 'mypassword' });
      expect(result.accessToken).toBeDefined();
      expect(mockPrisma.session.create).toHaveBeenCalled();
    });

    it('throws UnauthorizedException on wrong password', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-2',
        email: 'bad@pw.com',
        role: 'developer',
        status: 'active',
        passwordHash: await (await import('bcryptjs')).hash('realpw', 12),
      });
      await expect(service.login({ email: 'bad@pw.com', password: 'wrongpw' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refresh — token rotation', () => {
    it('returns a new token pair with same family', async () => {
      const { service, createRefreshToken } = makeService();
      const family = 'fam-abc';
      const oldRefresh = await createRefreshToken('u-3', 'developer', family);

      mockPrisma.session.findFirst.mockResolvedValue({
        id: 'sess-1',
        userId: 'u-3',
        tokenFamily: family,
        revoked: false,
      });
      mockPrisma.session.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-3',
        status: 'active',
        role: 'developer',
        email: 'ok@test.com',
      });

      const result = await service.refresh(oldRefresh);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockPrisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sess-1' }, data: { revoked: true } }),
      );
      expect(mockPrisma.session.create).toHaveBeenCalled();
    });

    it('revokes all sessions on token reuse (replay detection)', async () => {
      const { service, createRefreshToken } = makeService();
      const family = 'fam-replay';
      const oldRefresh = await createRefreshToken('u-4', 'developer', family);

      // Session exists but is already revoked → replay detected
      mockPrisma.session.findFirst.mockResolvedValue({
        id: 'sess-2',
        userId: 'u-4',
        tokenFamily: family,
        revoked: true,
      });

      await expect(service.refresh(oldRefresh)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-4' },
          data: { revoked: true },
        }),
      );
    });

    it('revoked session cannot refresh — all sessions revoked', async () => {
      const { service, createRefreshToken } = makeService();
      const family = 'fam-revoked';
      const oldRefresh = await createRefreshToken('u-4b', 'developer', family);

      // Session already revoked (e.g. user logged out on another device)
      mockPrisma.session.findFirst.mockResolvedValue({
        id: 'sess-rev',
        userId: 'u-4b',
        tokenFamily: family,
        revoked: true,
      });

      await expect(service.refresh(oldRefresh)).rejects.toThrow(
        'Token reuse detected — all sessions revoked',
      );
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-4b' },
          data: { revoked: true },
        }),
      );
    });

    it('revokes all sessions if no session found for token', async () => {
      const { service, createRefreshToken } = makeService();
      const oldRefresh = await createRefreshToken('u-5', 'developer', 'fam-ghost');

      mockPrisma.session.findFirst.mockResolvedValue(null);

      await expect(service.refresh(oldRefresh)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u-5' } }),
      );
    });

    it('throws on malformed jwt', async () => {
      const { service } = makeService();
      await expect(service.refresh('not-a-valid-jwt')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('access token — jti (session tracking)', () => {
    it('includes jti in the access token payload', async () => {
      const { service, jwt } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-jti',
        email: 'jti@test.com',
        role: 'developer',
        status: 'active',
        passwordHash: await (await import('bcryptjs')).hash('pw', 12),
      });

      const result = await service.login({ email: 'jti@test.com', password: 'pw' });
      const decoded = await jwt.verifyAsync(result.accessToken);
      expect(decoded.jti).toBeDefined();
      expect(typeof decoded.jti).toBe('string');
    });
  });

  describe('logout', () => {
    it('revokes all sessions for the user', async () => {
      const { service } = makeService();
      mockPrisma.session.updateMany.mockResolvedValue({});
      await service.logout('u-6');
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u-6' } }),
      );
    });
  });
});