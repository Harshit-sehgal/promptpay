import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { generateTotp } from '@waitlayer/shared';

// ── Prisma mock ──
const mockPrisma = {
  $transaction: vi.fn((cb) => cb(mockPrisma)),
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
      if (key === 'NODE_ENV') return 'test';
      return fallback ?? null;
    }),
  } as unknown as ConfigService;

  const googleVerifier = {
    verify: vi.fn(),
  } as any;
  const fraud = {
    computeTrustScore: vi.fn().mockResolvedValue(40),
  } as any;
  const email = {
    sendEmailVerification: vi.fn().mockResolvedValue({ delivered: true, driver: 'console' }),
    sendPasswordReset: vi.fn().mockResolvedValue({ delivered: true, driver: 'console' }),
    sendPasswordChanged: vi.fn().mockResolvedValue({ delivered: true, driver: 'console' }),
  } as any;
  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
  } as any;

  return {
    service: new AuthService(prismaRef, jwt, config, googleVerifier, fraud, email, audit),
    jwt,
    config,
    googleVerifier,
    fraud,
    email,
    createAccessToken: (sub: string, role: string, ttl = '15m', jti = 'access-jti') =>
      jwt.signAsync({ sub, role, aud: 'access', jti }, { expiresIn: ttl } as any),
    createRefreshToken: (sub: string, role: string, family: string, ttl = '30d', jti = 'sess-1') =>
      jwt.signAsync({ sub, role, family, aud: 'refresh', jti }, { expiresIn: ttl } as any),
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

    it('rolls back user creation if subsequent onboarding step fails', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u-1',
        email: 'dev@test.com',
        role: 'developer',
        status: 'active',
      });
      mockPrisma.userSettings.create.mockRejectedValueOnce(new Error('DB write failed'));

      await expect(
        service.signUp({
          email: 'dev@test.com',
          password: 'password123',
          role: 'developer' as any,
        }),
      ).rejects.toThrow('DB write failed');
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
        twoFactorEnabled: false,
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      });
      const result = await service.login({ email: 'ok@test.com', password: 'mypassword' });
      expect(result.accessToken).toBeDefined();
      expect('twoFactorSecret' in result.user).toBe(false);
      expect(mockPrisma.session.create).toHaveBeenCalled();
    });

    it('requires a valid TOTP code when two-factor authentication is enabled', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-2fa',
        email: '2fa@test.com',
        role: 'developer',
        status: 'active',
        passwordHash: await (await import('bcryptjs')).hash('mypassword', 12),
        twoFactorEnabled: true,
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      });

      await expect(service.login({ email: '2fa@test.com', password: 'mypassword' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.session.create).not.toHaveBeenCalled();
    });

    it('returns tokens for an MFA-enabled user with a valid TOTP code', async () => {
      const { service } = makeService();
      const secret = 'JBSWY3DPEHPK3PXP';
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-2fa',
        email: '2fa@test.com',
        role: 'developer',
        status: 'active',
        passwordHash: await (await import('bcryptjs')).hash('mypassword', 12),
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      const result = await service.login({
        email: '2fa@test.com',
        password: 'mypassword',
        twoFactorToken: generateTotp(secret),
      });
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

    it('does not issue tokens for restricted accounts', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-restricted',
        email: 'restricted@test.com',
        role: 'developer',
        status: 'restricted',
        passwordHash: await (await import('bcryptjs')).hash('mypassword', 12),
      });

      await expect(
        service.login({ email: 'restricted@test.com', password: 'mypassword' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.session.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh — token rotation', () => {
    it('returns a new token pair with same family', async () => {
      const { service, createRefreshToken } = makeService();
      const family = 'fam-abc';
      const oldRefresh = await createRefreshToken('u-3', 'developer', family, '30d', 'sess-1');

      // First updateMany (CAS) succeeds
      mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'sess-1',
        userId: 'u-3',
        tokenFamily: family,
        tokenHash: await (await import('bcryptjs')).hash(oldRefresh, 4),
        revoked: false,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-3',
        status: 'active',
        role: 'developer',
        email: 'ok@test.com',
      });

      const result = await service.refresh(oldRefresh);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'sess-1' }),
          data: { revoked: true },
        }),
      );
      expect(mockPrisma.session.create).toHaveBeenCalled();
    });

    it('revokes all sessions on token reuse (replay detection)', async () => {
      const { service, createRefreshToken } = makeService();
      const family = 'fam-replay';
      const oldRefresh = await createRefreshToken('u-4', 'developer', family, '30d', 'sess-2');

      // CAS fails (session already revoked) → load raced session to get family
      mockPrisma.session.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'sess-2',
        userId: 'u-4',
        tokenFamily: family,
        tokenHash: await (await import('bcryptjs')).hash(oldRefresh, 4),
        revoked: true,
      });

      await expect(service.refresh(oldRefresh)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'u-4' }),
          data: { revoked: true },
        }),
      );
    });

    it('revoked session cannot refresh — all sessions revoked', async () => {
      const { service, createRefreshToken } = makeService();
      const family = 'fam-revoked';
      const oldRefresh = await createRefreshToken('u-4b', 'developer', family, '30d', 'sess-rev');

      // CAS fails (session already revoked) → load raced session to get family
      mockPrisma.session.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'sess-rev',
        userId: 'u-4b',
        tokenFamily: family,
        tokenHash: await (await import('bcryptjs')).hash(oldRefresh, 4),
        revoked: true,
      });

      await expect(service.refresh(oldRefresh)).rejects.toThrow(
        'Token reuse detected — family sessions revoked',
      );
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'u-4b' }),
          data: { revoked: true },
        }),
      );
    });

    it('revokes all sessions if no session found for token', async () => {
      const { service, createRefreshToken } = makeService();
      const oldRefresh = await createRefreshToken('u-5', 'developer', 'fam-ghost', '30d', 'sess-ghost');

      mockPrisma.session.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(service.refresh(oldRefresh)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u-5' }) }),
      );
    });

    it('throws on malformed jwt', async () => {
      const { service } = makeService();
      await expect(service.refresh('not-a-valid-jwt')).rejects.toThrow(UnauthorizedException);
    });

    it('does not rotate refresh tokens for restricted accounts', async () => {
      const { service, createRefreshToken } = makeService();
      const family = 'fam-restricted';
      const oldRefresh = await createRefreshToken('u-restricted', 'developer', family, '30d', 'sess-restricted');

      mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'sess-restricted',
        userId: 'u-restricted',
        tokenFamily: family,
        tokenHash: await (await import('bcryptjs')).hash(oldRefresh, 4),
        revoked: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-restricted',
        status: 'restricted',
        role: 'developer',
        email: 'restricted@test.com',
      });

      await expect(service.refresh(oldRefresh)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.session.create).not.toHaveBeenCalled();
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

  describe('email verification flow', () => {
    it('should generate verification token and send email if not already verified', async () => {
      const { service, email } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-verify', email: 'test@verify.com', emailVerified: false });

      const res = await service.requestEmailVerification('u-verify');
      expect(res.token).toBeDefined();
      expect(res.message).toBe('Verification email sent');
      expect(email.sendEmailVerification).toHaveBeenCalledWith('test@verify.com', res.token);
    });

    it('should throw BadRequestException on request if already verified', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-verify', email: 'test@verify.com', emailVerified: true });

      await expect(service.requestEmailVerification('u-verify')).rejects.toThrow(BadRequestException);
    });

    it('should confirm verification, update flag, and recalculate trust score', async () => {
      const { service, fraud } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-verify', email: 'test@verify.com', emailVerified: false });
      mockPrisma.user.update.mockResolvedValue({ id: 'u-verify', emailVerified: true });

      const reqRes = await service.requestEmailVerification('u-verify');
      const confirmRes = await service.confirmEmailVerification(reqRes.token);

      expect(confirmRes.message).toBe('Email verified successfully');
      expect(confirmRes.email).toBe('test@verify.com');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-verify' },
        data: { emailVerified: true },
      });
      expect(fraud.computeTrustScore).toHaveBeenCalledWith('u-verify');
    });

    it('should throw BadRequestException if token is invalid or expired', async () => {
      const { service } = makeService();
      await expect(service.confirmEmailVerification('invalid-token')).rejects.toThrow(BadRequestException);
    });
  });

  describe('password reset flow', () => {
    const resetUser = {
      id: 'u-reset',
      email: 'reset@test.com',
      role: 'developer',
      status: 'active',
      passwordHash: '$2a$12$original-hash',
    };

    it('returns a generic message and does not send email for unknown accounts', async () => {
      const { service, email } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await service.requestPasswordReset('nobody@test.com');
      expect(res.message).toContain('If an account exists');
      expect((res as any).token).toBeUndefined();
      expect(email.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('returns a generic message and does not send email for banned accounts', async () => {
      const { service, email } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({ ...resetUser, status: 'banned' });

      const res = await service.requestPasswordReset('reset@test.com');
      expect(res.message).toContain('If an account exists');
      expect(email.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('returns a generic message and does not send email for restricted accounts', async () => {
      const { service, email } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({ ...resetUser, status: 'restricted' });

      const res = await service.requestPasswordReset('reset@test.com');
      expect(res.message).toContain('If an account exists');
      expect(email.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('issues a token and sends the reset email for a valid account', async () => {
      const { service, email } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(resetUser);

      const res = await service.requestPasswordReset('reset@test.com');
      expect((res as any).token).toBeDefined();
      expect(email.sendPasswordReset).toHaveBeenCalledWith('reset@test.com', (res as any).token);
    });

    it('resets the password, revokes all sessions, and sends a notification', async () => {
      const { service, email } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(resetUser);

      const reqRes = await service.requestPasswordReset('reset@test.com');
      const res = await service.resetPassword((reqRes as any).token, 'new-password-123');

      expect(res.message).toContain('Password reset successfully');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-reset' },
          data: { passwordHash: expect.stringMatching(/^\$2[aby]\$/) },
        }),
      );
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u-reset' } }),
      );
      expect(email.sendPasswordChanged).toHaveBeenCalledWith('reset@test.com');
    });

    it('rejects a reset token after the password has changed (single-use)', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(resetUser);

      const reqRes = await service.requestPasswordReset('reset@test.com');

      // Password changed since the token was issued → fingerprint mismatch
      mockPrisma.user.findUnique.mockResolvedValue({ ...resetUser, passwordHash: '$2a$12$different-hash' });

      await expect(
        service.resetPassword((reqRes as any).token, 'new-password-123'),
      ).rejects.toThrow('Reset token is no longer valid');
    });

    it('rejects invalid tokens and tokens with the wrong action', async () => {
      const { service, jwt } = makeService();

      await expect(service.resetPassword('garbage-token', 'new-password-123')).rejects.toThrow(
        BadRequestException,
      );

      const wrongAction = await jwt.signAsync(
        { sub: 'u-reset', action: 'email-verification', fp: 'abc' },
        { expiresIn: '1h' } as any,
      );
      await expect(service.resetPassword(wrongAction, 'new-password-123')).rejects.toThrow(
        'Invalid token action',
      );
    });

    it('rejects reset for banned accounts', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(resetUser);
      const reqRes = await service.requestPasswordReset('reset@test.com');

      mockPrisma.user.findUnique.mockResolvedValue({ ...resetUser, status: 'banned' });
      // Security: a banned/deleted account must NOT be distinguishable from an
      // invalid/expired token — that would let an attacker enumerate account
      // status via the reset flow. Both branches return the identical
      // BadRequestException "Invalid or expired reset token".
      await expect(
        service.resetPassword((reqRes as any).token, 'new-password-123'),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('rejects reset for restricted accounts', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue(resetUser);
      const reqRes = await service.requestPasswordReset('reset@test.com');

      mockPrisma.user.findUnique.mockResolvedValue({ ...resetUser, status: 'restricted' });
      await expect(
        service.resetPassword((reqRes as any).token, 'new-password-123'),
      ).rejects.toThrow('Invalid or expired reset token');
    });
  });

  describe('googleOAuth flow', () => {
    it('should log in existing user by googleId', async () => {
      const { service, googleVerifier } = makeService();
      googleVerifier.verify.mockResolvedValue({
        sub: 'google-123',
        email: 'google@test.com',
        email_verified: true,
        name: 'Google User',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-google',
        email: 'google@test.com',
        googleId: 'google-123',
        role: 'developer',
        status: 'active',
      });

      const res = await service.googleOAuth({ idToken: 'some-token' });
      expect(res.user.id).toBe('u-google');
      expect(res.accessToken).toBeDefined();
    });

    it('requires a valid TOTP code for an MFA-enabled Google account', async () => {
      const { service, googleVerifier } = makeService();
      googleVerifier.verify.mockResolvedValue({
        sub: 'google-2fa',
        email: 'google-2fa@test.com',
        email_verified: true,
        name: 'Google MFA User',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-google-2fa',
        email: 'google-2fa@test.com',
        googleId: 'google-2fa',
        role: 'developer',
        status: 'active',
        twoFactorEnabled: true,
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      });

      await expect(service.googleOAuth({ idToken: 'some-token' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.session.create).not.toHaveBeenCalled();
    });

    it('does not issue tokens for restricted Google accounts', async () => {
      const { service, googleVerifier } = makeService();
      googleVerifier.verify.mockResolvedValue({
        sub: 'google-restricted',
        email: 'google-restricted@test.com',
        email_verified: true,
        name: 'Restricted Google User',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-google-restricted',
        email: 'google-restricted@test.com',
        googleId: 'google-restricted',
        role: 'developer',
        status: 'restricted',
      });

      await expect(service.googleOAuth({ idToken: 'some-token' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.session.create).not.toHaveBeenCalled();
    });

    it('should create a new developer profile and return tokens if new user signs up via Google', async () => {
      const { service, googleVerifier } = makeService();
      googleVerifier.verify.mockResolvedValue({
        sub: 'google-456',
        email: 'new-google@test.com',
        email_verified: true,
        name: 'New Google User',
      });
      // Mock findUnique to return null (user doesn't exist)
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u-new-google',
        email: 'new-google@test.com',
        googleId: 'google-456',
        role: 'developer',
        status: 'active',
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u-new-google',
        email: 'new-google@test.com',
        googleId: 'google-456',
        role: 'developer',
        status: 'active',
      });

      const res = await service.googleOAuth({ idToken: 'some-token', role: 'developer' as any });
      expect(res.user.id).toBe('u-new-google');
      expect(res.accessToken).toBeDefined();
    });
  });

  describe('two-factor setup', () => {
    it('stores the TOTP secret encrypted while returning the provisioning secret once', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-setup',
        email: 'setup@test.com',
        role: 'developer',
        twoFactorEnabled: false,
        twoFactorSecret: null,
      });

      const result = await service.setupTwoFactor('u-setup');
      const storedSecret = mockPrisma.user.update.mock.calls[0][0].data.twoFactorSecret;

      expect(result.secret).toEqual(expect.any(String));
      expect(storedSecret).toEqual(expect.stringMatching(/^v1:/));
      expect(storedSecret).not.toBe(result.secret);
    });

    it('refuses to rotate an enabled TOTP secret without first disabling 2FA', async () => {
      const { service } = makeService();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-2fa',
        email: '2fa@test.com',
        role: 'developer',
        twoFactorEnabled: true,
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      });

      await expect(service.setupTwoFactor('u-2fa')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
