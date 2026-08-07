// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MFA_RELOGIN_REQUIRED_KEY } from '@/lib/admin-mfa';
import api from '@/lib/api/client';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AuthProvider, useAuth } from './auth-context';

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

function Harness() {
  const { login, googleLogin } = useAuth();
  return (
    <>
      <button
        type="button"
        onClick={() => void login('admin@example.com', 'password', 'ABCD-EFGH-JKMN')}
      >
        Password login
      </button>
      <button
        type="button"
        onClick={() => void googleLogin('google-id-token', undefined, '234567')}
      >
        Google login
      </button>
      <button
        type="button"
        onClick={() => void googleLogin('google-id-token', undefined, 'PQRS-TUVW-XYZ2')}
      >
        Google backup login
      </button>
    </>
  );
}

describe('AuthProvider two-factor proof mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api.get).mockRejectedValue(new Error('signed out'));
    vi.mocked(api.post).mockResolvedValue({
      data: {
        user: {
          id: 'admin-1',
          email: 'admin@example.com',
          role: 'super_admin',
          status: 'active',
          twoFactorEnabled: true,
        },
      },
    } as never);
  });

  afterEach(() => cleanup());

  it('sends a canonical backup code on password login and clears the admin re-login blocker', async () => {
    localStorage.setItem(ADMIN_MFA_RELOGIN_REQUIRED_KEY, '1');
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Password login' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'admin@example.com',
        password: 'password',
        twoFactorBackupCode: 'ABCD-EFGH-JKMN',
      }),
    );
    expect(localStorage.getItem(ADMIN_MFA_RELOGIN_REQUIRED_KEY)).toBeNull();
  });

  it('sends a six-digit TOTP on Google login', async () => {
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Google login' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/google', {
        idToken: 'google-id-token',
        role: undefined,
        twoFactorToken: '234567',
      }),
    );
  });

  it('sends a canonical backup code on Google login', async () => {
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Google backup login' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/google', {
        idToken: 'google-id-token',
        role: undefined,
        twoFactorBackupCode: 'PQRS-TUVW-XYZ2',
      }),
    );
  });
});
