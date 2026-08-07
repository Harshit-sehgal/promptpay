// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MFA_RELOGIN_REQUIRED_KEY } from '@/lib/admin-mfa';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdminSecurityPage from './page';

const { logout, refreshUser, replace } = vi.hoisted(() => ({
  logout: vi.fn(),
  refreshUser: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: {
      email: 'admin@example.com',
      role: 'super_admin',
      hasPassword: true,
      twoFactorEnabled: false,
    },
    logout,
    refreshUser,
  }),
}));

vi.mock('@/components/two-factor-enrolment', () => ({
  TwoFactorEnrolment: ({
    onChange,
    onEnrollmentRequiresRelogin,
  }: {
    onChange: (enabled: boolean) => void;
    onEnrollmentRequiresRelogin: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onChange(true);
        onEnrollmentRequiresRelogin();
      }}
    >
      Complete enrollment
    </button>
  ),
}));

describe('admin security enrollment boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    refreshUser.mockResolvedValue({});
    logout.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it('keeps admin writes blocked until the administrator signs in again with 2FA', async () => {
    render(<AdminSecurityPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete enrollment' }));

    expect(localStorage.getItem(ADMIN_MFA_RELOGIN_REQUIRED_KEY)).toBe('1');
    expect(await screen.findByText(/this session is not MFA-authenticated/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and verify 2FA' }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/auth/login?returnTo=%2Fadmin%2Fsecurity');
  });
});
