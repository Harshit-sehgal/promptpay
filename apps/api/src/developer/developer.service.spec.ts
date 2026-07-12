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
  earningsLedger: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  adImpression: {
    findMany: vi.fn(),
  },
  adClick: {
    findMany: vi.fn(),
  },
  payoutRequest: {
    findMany: vi.fn(),
  },
  consent: {
    findMany: vi.fn(),
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
    service = new DeveloperService(
      mockPrisma as any,
      mockFraud,
      mockAudit,
      mockGoogleVerifier,
      mockEmail,
    );
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
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete_account_reauth_failed',
          afterSnap: { reason: 'bad_password' },
        }),
      );
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
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user_123',
          actorRole: 'developer',
          action: 'delete_account',
        }),
      );
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

  describe('exportData', () => {
    it('adds explicit truncation metadata for capped high-volume collections', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_123', email: 'dev@test.com' });
      mockPrisma.earningsLedger.findMany.mockResolvedValue(
        Array.from({ length: 10001 }, (_, i) => ({ id: `earn_${i}` })),
      );
      mockPrisma.adImpression.findMany.mockResolvedValue(
        Array.from({ length: 1001 }, (_, i) => ({ id: `imp_${i}` })),
      );
      mockPrisma.adClick.findMany.mockResolvedValue([{ id: 'click_1' }]);
      mockPrisma.payoutRequest.findMany.mockResolvedValue(
        Array.from({ length: 1001 }, (_, i) => ({ id: `payout_${i}` })),
      );
      mockPrisma.consent.findMany.mockResolvedValue([{ id: 'consent_1' }]);

      const exported = await service.exportData('user_123');

      expect(mockPrisma.earningsLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10001 }),
      );
      expect(mockPrisma.adImpression.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1001, orderBy: { createdAt: 'desc' } }),
      );
      expect(exported.earnings).toHaveLength(10000);
      expect(exported.impressions).toHaveLength(1000);
      expect(exported.clicks).toHaveLength(1);
      expect(exported.payouts).toHaveLength(1000);
      expect(exported.exportMeta).toMatchObject({
        exportType: 'self_service_recent_activity',
        complete: false,
        truncated: true,
        collections: {
          earnings: { limit: 10000, returned: 10000, truncated: true },
          impressions: { limit: 1000, returned: 1000, truncated: true },
          clicks: { limit: 1000, returned: 1, truncated: false },
          payouts: { limit: 1000, returned: 1000, truncated: true },
        },
      });
      expect(exported.exportMeta.generatedAt).toEqual(expect.any(String));
    });
  });

  describe('getEarningsSummary', () => {
    it('aggregates ledger totals in the database instead of loading every row', async () => {
      mockPrisma.earningsLedger.groupBy.mockResolvedValue([
        {
          status: 'estimated',
          entryType: 'credit',
          currency: 'USD',
          _sum: { amountMinor: 125n },
        },
        {
          status: 'confirmed',
          entryType: 'credit',
          currency: 'USD',
          _sum: { amountMinor: 1000n },
        },
        {
          status: 'confirmed',
          entryType: 'debit',
          currency: 'USD',
          _sum: { amountMinor: 250n },
        },
        {
          status: 'held',
          entryType: 'credit',
          currency: 'EUR',
          _sum: { amountMinor: 300n },
        },
      ]);

      const summary = await service.getEarningsSummary('user_123');

      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledWith({
        by: ['status', 'entryType', 'currency'],
        where: { userId: 'user_123' },
        _sum: { amountMinor: true },
      });
      expect(mockPrisma.earningsLedger.findMany).not.toHaveBeenCalled();
      expect(summary.estimatedEarnings).toBe(125n);
      expect(summary.confirmedEarnings).toBe(750n);
      expect(summary.availableForPayout).toBe(750n);
      expect(summary.lifetimeEarnings).toBe(875n);
      expect(summary.heldEarningsByCurrency).toEqual({ EUR: 300n });
    });
  });
});
