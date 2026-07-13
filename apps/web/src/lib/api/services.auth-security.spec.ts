import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import { advertiserApi, authApi, payoutApi } from '@/lib/api/services';

vi.mock('@/lib/api/client', () => ({
  default: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));

describe('auth security API helpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a fresh password proof before TOTP setup', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

    await authApi.setup2fa({ currentPassword: 'fresh-proof' });

    expect(api.post).toHaveBeenCalledWith('/auth/2fa/setup', {
      currentPassword: 'fresh-proof',
    });
  });

  it('links Google with both identity and current-account proofs', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

    await authApi.linkGoogle('google-id-token', 'fresh-proof');

    expect(api.post).toHaveBeenCalledWith('/auth/link/google', {
      idToken: 'google-id-token',
      currentPassword: 'fresh-proof',
    });
  });

  it('routes self-service session revocation without exposing another user id', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

    await authApi.revokeSession('session-123');
    await authApi.revokeOtherSessions();

    expect(api.post).toHaveBeenNthCalledWith(1, '/auth/sessions/session-123/revoke');
    expect(api.post).toHaveBeenNthCalledWith(2, '/auth/sessions/revoke-others');
  });

  it('regenerates recovery codes only with a current TOTP proof', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

    await authApi.regenerate2faBackupCodes('123456');

    expect(api.post).toHaveBeenCalledWith('/auth/2fa/backup-codes/regenerate', {
      token: '123456',
    });
  });

  it('creates advertiser keys without a client-controlled advertiser id', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

    await advertiserApi.createApiKey(['campaigns:read', 'reports:read']);

    expect(api.post).toHaveBeenCalledWith('/advertiser/api-keys', {
      scopes: ['campaigns:read', 'reports:read'],
    });
  });

  it('gets effective payout readiness from the authenticated API', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { providers: [] } });

    await payoutApi.getProviders();

    expect(api.get).toHaveBeenCalledWith('/payout/providers');
  });
});
