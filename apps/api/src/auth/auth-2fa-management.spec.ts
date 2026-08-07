import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { ActionStepUpGuard, STEP_UP_ACTION_KEY } from '../common/guards/action-step-up.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthTotpTrait } from './auth-totp.trait';

describe('2FA recovery management', () => {
  it.each([
    ['disableTwoFactor', '2fa:disable'],
    ['regenerateTwoFactorBackupCodes', '2fa:regenerate'],
  ] as const)('%s requires an action-scoped TOTP-or-backup step-up', (method, action) => {
    const handler = AuthController.prototype[method];
    expect(Reflect.getMetadata(STEP_UP_ACTION_KEY, handler)).toBe(action);
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, ActionStepUpGuard]));
  });

  it('controller passes only identity/session context after the guard succeeds', async () => {
    const authService = {
      disableTwoFactor: vi.fn().mockResolvedValue({ twoFactorEnabled: false }),
      regenerateTwoFactorBackupCodes: vi.fn().mockResolvedValue({ backupCodes: [] }),
    };
    const controller = new AuthController(authService as never, {} as never);

    await controller.disableTwoFactor('user-1', 'session-current');
    await controller.regenerateTwoFactorBackupCodes('user-1', 'session-current');

    expect(authService.disableTwoFactor).toHaveBeenCalledWith('user-1', 'session-current');
    expect(authService.regenerateTwoFactorBackupCodes).toHaveBeenCalledWith(
      'user-1',
      'session-current',
    );
  });

  it('revokes other sessions while keeping the step-up-authenticated session usable', async () => {
    const tx = {
      user: { update: vi.fn().mockResolvedValue({}) },
      session: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const trait = new AuthTotpTrait() as AuthTotpTrait & {
      prisma: unknown;
      audit: unknown;
      totpEncryptionKey: Buffer;
    };
    trait.prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          role: 'developer',
          twoFactorEnabled: true,
          twoFactorSecret: 'secret',
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    trait.audit = { logStrict: vi.fn().mockResolvedValue(undefined) };
    trait.totpEncryptionKey = Buffer.alloc(32, 7);

    await trait.disableTwoFactor('user-1', 'session-current');

    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { not: 'session-current' } },
      data: { revoked: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodeHashes: [],
      },
    });
  });
});
