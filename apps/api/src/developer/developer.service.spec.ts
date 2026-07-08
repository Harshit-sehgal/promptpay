import * as bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { DeveloperService } from './developer.service';

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  session: {
    updateMany: vi.fn(),
  },
  apiKey: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
};

const mockFraud = {} as any;
const mockAudit = {
  log: vi.fn().mockResolvedValue(undefined),
} as any;
const mockGoogleVerifier = {
  verify: vi.fn(),
} as any;
const mockEmail = {
  sendAccountDeleted: vi.fn().mockResolvedValue(undefined),
} as any;

describe('DeveloperService', () => {
  let service: DeveloperService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({ id: 'user_123', status: 'deleted' });
    mockPrisma.session.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.apiKey.updateMany.mockResolvedValue({ count: 1 });
    service = new DeveloperService(mockPrisma as any, mockFraud, mockAudit, mockGoogleVerifier, mockEmail);
  });

  describe('deleteAccount', () => {
    it('requires explicit confirmation before self-service deletion', async () => {
      await expect(service.deleteAccount('user_123')).rejects.toThrow(
        'Account deletion requires explicit confirmation',
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('requires the current password for password-backed self-service deletion', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_123',
        email: 'dev@test.com',
        passwordHash: await bcrypt.hash('correct-password', 12),
        googleId: null,
      });

      await expect(
        service.deleteAccount('user_123', {
          confirmation: 'DELETE_MY_ACCOUNT',
          currentPassword: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete_account_reauth_failed',
        afterSnap: { reason: 'bad_password' },
      }));
    });

    it('deletes a password-backed account after current-password step-up', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_123',
        email: 'dev@test.com',
        passwordHash: await bcrypt.hash('correct-password', 12),
        googleId: null,
      });

      await service.deleteAccount('user_123', {
        confirmation: 'DELETE_MY_ACCOUNT',
        currentPassword: 'correct-password',
      });

      expect(mockPrisma.user.update).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'user_123',
        actorRole: 'developer',
        action: 'delete_account',
      }));
    });

    it('deletes a Google-linked passwordless account after matching Google re-authentication', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_123',
        email: 'google@test.com',
        passwordHash: null,
        googleId: 'google-sub-123',
      });
      mockGoogleVerifier.verify.mockResolvedValue({
        sub: 'google-sub-123',
        email: 'google@test.com',
        email_verified: true,
      });

      await service.deleteAccount('user_123', {
        confirmation: 'DELETE_MY_ACCOUNT',
        googleIdToken: 'google-token',
      });

      expect(mockGoogleVerifier.verify).toHaveBeenCalledWith('google-token');
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('anonymizes identity fields, clears MFA secrets, revokes credentials, and logs the supplied actor', async () => {
      await service.deleteAccount('user_123', {
        auditActor: {
          actorId: 'admin_123',
          actorRole: 'admin',
          action: 'admin_erased_user',
        },
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_123' },
        data: expect.objectContaining({
          status: 'deleted',
          email: 'deleted-user_123@waitlayer.com',
          passwordHash: null,
          googleId: null,
          githubId: null,
          googleVerified: false,
          githubVerified: false,
          emailVerified: false,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          name: null,
          referralCode: null,
          country: null,
        }),
      });
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user_123' },
        data: { revoked: true },
      });
      expect(mockPrisma.apiKey.updateMany).toHaveBeenCalledWith({
        where: { ownerId: 'user_123' },
        data: { isActive: false },
      });
      expect(mockAudit.log).toHaveBeenCalledWith({
        actorId: 'admin_123',
        actorRole: 'admin',
        action: 'admin_erased_user',
        targetType: 'user',
        targetId: 'user_123',
      });
    });
  });
});
