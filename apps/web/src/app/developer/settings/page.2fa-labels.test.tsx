// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi, developerApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import DevSettingsPage from './page';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr'),
  },
}));

vi.mock('@/components', () => ({
  LoadingSpinner: () => null,
}));

vi.mock('@/lib/api/services', () => ({
  authApi: {
    setup2fa: vi.fn(),
    enable2fa: vi.fn(),
    disable2fa: vi.fn(),
  },
  developerApi: {
    getSettings: vi.fn(),
    listApiKeys: vi.fn(),
  },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { emailVerified: true },
    isAuthenticated: true,
  }),
}));

vi.mock('@waitlayer/ui', () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

const baseSettings = {
  adsEnabled: true,
  quietMode: false,
  maxAdsPerHour: 6,
  blockedCategories: [],
  email: 'developer@example.com',
  twoFactorEnabled: false,
};

describe('developer settings 2FA labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(developerApi.getSettings).mockResolvedValue({ data: baseSettings } as never);
    vi.mocked(developerApi.listApiKeys).mockResolvedValue({ data: [] } as never);
    vi.mocked(authApi.setup2fa).mockResolvedValue({
      data: {
        secret: 'TESTSECRET',
        otpauthUrl: 'otpauth://totp/WaitLayer:test',
      },
    } as never);
  });

  afterEach(() => cleanup());

  it('associates the setup verification code', async () => {
    render(<DevSettingsPage />);

    // A-100: `POST /auth/2fa/setup` requires a re-authentication proof, so the
    // flow now collects the current password before requesting a secret.
    fireEvent.change(await screen.findByLabelText('Current password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Enable 2FA' }));
    const input = await screen.findByLabelText('Verification code');
    expect(input.id).toBe('two-factor-enable-code');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('sends the re-authentication proof to setup2fa (A-100 regression)', async () => {
    // Without `currentPassword` the API returns 401 "Reauthentication is
    // required before setting up 2FA", which made 2FA enrolment impossible for
    // every role — and therefore made admin writes and developer payouts
    // impossible in production. Pin the call shape.
    render(<DevSettingsPage />);

    fireEvent.change(await screen.findByLabelText('Current password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Enable 2FA' }));

    await screen.findByLabelText('Verification code');
    expect(authApi.setup2fa).toHaveBeenCalledWith({
      currentPassword: 'correct-horse-battery',
    });
  });

  it('does not call setup2fa without a password', async () => {
    render(<DevSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Enable 2FA' }));

    expect(authApi.setup2fa).not.toHaveBeenCalled();
  });

  it('associates the disable verification code', async () => {
    vi.mocked(developerApi.getSettings).mockResolvedValue({
      data: { ...baseSettings, twoFactorEnabled: true },
    } as never);

    render(<DevSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable 2FA' }));
    const input = screen.getByLabelText('Verification code');
    expect(input.id).toBe('two-factor-disable-code');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
  });
});
