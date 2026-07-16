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

    fireEvent.click(await screen.findByRole('button', { name: 'Enable 2FA' }));
    const input = await screen.findByLabelText('Verification code');
    expect(input.id).toBe('two-factor-enable-code');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
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
