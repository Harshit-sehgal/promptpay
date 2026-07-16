// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import ForgotPasswordPage from './forgot-password/page';
import LoginPage from './login/page';
import ResetPasswordPage from './reset-password/page';
import SignupPage from './signup/page';

const { push, login, signup, googleLogin } = vi.hoisted(() => ({
  push: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  googleLogin: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('token=reset-token'),
}));

vi.mock('@/lib/api/client', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('@/lib/api/services', () => ({
  authApi: {
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ login, signup, googleLogin }),
}));

describe('auth form label associations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      data: { terms_of_service: '2026-07-16' },
    } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('associates every login field, including the 2FA code', async () => {
    render(<LoginPage />);

    expect(screen.getByLabelText('Email').id).toBe('login-email');
    expect(screen.getByLabelText('Password').id).toBe('login-password');
    expect(screen.getByLabelText('2FA code').id).toBe('login-two-factor');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it('associates signup fields for both account types', async () => {
    render(<SignupPage />);

    expect(screen.getByLabelText('Email').id).toBe('signup-email');
    expect(screen.getByLabelText('Password').id).toBe('signup-password');
    expect(screen.getByLabelText(/Referral code/).id).toBe('signup-referral-code');
    expect(screen.getByLabelText(/I confirm that I am at least 18/).id).toBe(
      'signup-age-confirmation',
    );

    const developerRole = screen.getByRole('radio', { name: 'Developer' }) as HTMLInputElement;
    const advertiserRole = screen.getByRole('radio', { name: 'Advertiser' }) as HTMLInputElement;
    expect(developerRole.checked).toBe(true);
    fireEvent.click(advertiserRole);
    expect(advertiserRole.checked).toBe(true);
    expect(screen.getByLabelText('Company name').id).toBe('signup-company-name');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/consent/required-versions'));
  });

  it('associates the forgot-password email field', () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByLabelText('Email').id).toBe('forgot-password-email');
  });

  it('associates both reset-password fields', () => {
    render(<ResetPasswordPage />);

    expect(screen.getByLabelText('New password').id).toBe('reset-password-new');
    expect(screen.getByLabelText('Confirm new password').id).toBe('reset-password-confirm');
  });
});
