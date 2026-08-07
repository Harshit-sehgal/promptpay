// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advertiserApi, authApi, developerApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccountErasure } from './account-erasure';

const { logout, replace } = vi.hoisted(() => ({
  logout: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ logout }),
}));

vi.mock('@/lib/api/services', () => ({
  authApi: { forgotPassword: vi.fn() },
  developerApi: { deleteAccount: vi.fn() },
  advertiserApi: { deleteAccount: vi.fn() },
}));

describe('AccountErasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logout.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it('submits a developer erasure with password, forfeit decision, and exact confirmation', async () => {
    vi.mocked(developerApi.deleteAccount).mockResolvedValue({ data: { deleted: true } } as never);
    render(
      <AccountErasure
        role="developer"
        hasPassword
        twoFactorEnabled
        accountEmail="dev@example.com"
        redirectAfterDeletion={replace}
      />,
    );

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.change(screen.getByLabelText('Type DELETE_MY_ACCOUNT'), {
      target: { value: 'DELETE_MY_ACCOUNT' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));

    await waitFor(() =>
      expect(developerApi.deleteAccount).toHaveBeenCalledWith({
        confirmation: 'DELETE_MY_ACCOUNT',
        currentPassword: 'correct-horse-battery',
        forfeitBalance: true,
      }),
    );
    expect(logout).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/auth/login?deleted=1');
  });

  it('keeps advertiser deletion locked until 2FA is enabled', () => {
    render(
      <AccountErasure
        role="advertiser"
        hasPassword
        twoFactorEnabled={false}
        accountEmail="advertiser@example.com"
      />,
    );

    expect(screen.getByText(/Enable two-factor authentication above first/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Permanently delete my account' })).toBeNull();
    expect(advertiserApi.deleteAccount).not.toHaveBeenCalled();
  });

  it('does not report a completed erasure as failed when cookie cleanup loses the network', async () => {
    vi.mocked(advertiserApi.deleteAccount).mockResolvedValue({ data: { deleted: true } } as never);
    logout.mockRejectedValue(new Error('network unavailable'));
    render(
      <AccountErasure
        role="advertiser"
        hasPassword
        twoFactorEnabled
        accountEmail="advertiser@example.com"
        redirectAfterDeletion={replace}
      />,
    );

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.change(screen.getByLabelText('Type DELETE_MY_ACCOUNT'), {
      target: { value: 'DELETE_MY_ACCOUNT' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/auth/login?deleted=1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers Google-only users a secure password setup email without support', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ data: { ok: true } } as never);
    render(
      <AccountErasure
        role="advertiser"
        hasPassword={false}
        twoFactorEnabled={false}
        accountEmail="google@example.com"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Email me a password setup link' }));
    await waitFor(() => expect(authApi.forgotPassword).toHaveBeenCalledWith('google@example.com'));
    expect(screen.queryByText(/support-assisted/i)).toBeNull();
  });
});
