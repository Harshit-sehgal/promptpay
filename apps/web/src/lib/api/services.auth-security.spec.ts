import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import { advertiserApi, authApi, developerApi, payoutApi } from '@/lib/api/services';

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

  it('lets the interceptor obtain a TOTP-or-backup step-up for 2FA management', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

    await authApi.regenerate2faBackupCodes();
    await authApi.disable2fa();

    expect(api.post).toHaveBeenNthCalledWith(1, '/auth/2fa/backup-codes/regenerate', {});
    expect(api.post).toHaveBeenNthCalledWith(2, '/auth/2fa/disable', {});
  });

  it('preserves the explicit balance-forfeit choice on both self-service erasure routes', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    const proof = {
      confirmation: 'DELETE_MY_ACCOUNT' as const,
      currentPassword: 'fresh-proof',
      forfeitBalance: true,
    };

    await developerApi.deleteAccount(proof);
    await advertiserApi.deleteAccount(proof);

    expect(api.post).toHaveBeenNthCalledWith(1, '/developer/delete-account', proof);
    expect(api.post).toHaveBeenNthCalledWith(2, '/advertiser/delete-account', proof);
  });

  it('gets effective payout readiness from the authenticated API', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { providers: [] } });

    await payoutApi.getProviders();

    expect(api.get).toHaveBeenCalledWith('/payout/providers');
  });

  it('rejects malformed payout readiness instead of treating it as available', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { providers: [{ provider: 'manual', status: 'available' }] },
    });

    await expect(payoutApi.getProviders()).rejects.toThrow();
  });

  it('removes a payout method through the guarded method route', async () => {
    (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { removed: true },
    });

    await payoutApi.removeMethod('method-123');

    expect(api.delete).toHaveBeenCalledWith('/payout/method/method-123');
  });

  it('starts Stripe Connect onboarding through the guarded payout route', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        accountId: 'acct_123',
        onboardingUrl: 'https://connect.stripe.com/setup/test',
      },
    });
    const request = {
      refreshUrl: 'https://app.example/developer/payouts?stripe_status=refresh',
      returnUrl: 'https://app.example/developer/payouts?stripe_status=success',
      currency: 'USD',
    };

    await payoutApi.createStripeConnectOnboarding(request);

    expect(api.post).toHaveBeenCalledWith('/payout/stripe-connect/onboarding', request);
  });
});
