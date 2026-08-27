// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import LoginPage from './page';

type GoogleCallback = (response: { credential: string }) => Promise<void>;

const { push, login, googleLogin, refreshUser, linkGoogle } = vi.hoisted(() => ({
  push: vi.fn(),
  login: vi.fn(),
  googleLogin: vi.fn(),
  refreshUser: vi.fn(),
  linkGoogle: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ login, googleLogin, refreshUser }),
}));

vi.mock('@/lib/api/services', () => ({
  authApi: { linkGoogle },
}));

const googleApi = {
  accounts: {
    id: {
      initialize: vi.fn(),
      renderButton: vi.fn(),
    },
  },
};

const credential = `header.${btoa(JSON.stringify({ email: 'advertiser@example.com' }))}.sig`;

async function preparePendingGoogleLink() {
  render(<LoginPage />);

  const script = await waitFor(() => {
    const element = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (!(element instanceof HTMLScriptElement)) throw new Error('GIS script not appended');
    return element;
  });

  await act(async () => {
    script.onload?.(new Event('load'));
  });
  await waitFor(() => expect(googleApi.accounts.id.initialize).toHaveBeenCalled());

  const initializeCall = googleApi.accounts.id.initialize.mock.calls.at(-1)?.[0] as
    { callback: GoogleCallback } | undefined;
  if (!initializeCall) throw new Error('GIS callback was not registered');

  await act(async () => {
    await initializeCall.callback({ credential });
  });

  const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
  expect(emailInput.value).toBe('advertiser@example.com');
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct-password' },
  });
}

describe('Google linking during password sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/auth/login');
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: googleApi,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ googleClientId: 'client.apps.googleusercontent.com' }),
      }),
    );
    googleLogin.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message:
            'An account with this email already exists. Sign in with your password and link Google from your account settings.',
        },
      },
    });
    login.mockResolvedValue({ role: 'advertiser' });
    refreshUser.mockResolvedValue({ role: 'advertiser', googleVerified: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refreshes the authenticated profile before redirecting after a successful link', async () => {
    linkGoogle.mockResolvedValue({ data: {} });
    await preparePendingGoogleLink();

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Sign in form' }));
    });

    await waitFor(() => expect(linkGoogle).toHaveBeenCalledWith(credential, 'correct-password'));
    await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith('/advertiser');
  });

  it('shows the link failure and a settings recovery path without redirecting', async () => {
    const linkError = {
      response: { status: 401, data: { message: 'Password proof was rejected' } },
      config: {
        data: JSON.stringify({ currentPassword: 'correct-password', idToken: credential }),
      },
      message: 'Request failed with status code 401',
    };
    linkGoogle.mockRejectedValue(linkError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await preparePendingGoogleLink();

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Sign in form' }));
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your password sign-in succeeded');
    expect(alert.textContent).toContain('Password proof was rejected');
    expect(
      screen.getByRole('link', { name: 'Open account settings to retry' }).getAttribute('href'),
    ).toBe('/advertiser/settings');
    expect(push).not.toHaveBeenCalled();
    expect(refreshUser).not.toHaveBeenCalled();

    const loggedCall = warn.mock.calls.find(
      ([message]) => message === 'Google link after sign-in failed',
    );
    expect(loggedCall?.[1]).toMatchObject({
      status: 401,
      message: 'Request failed with status code 401',
    });
    expect(loggedCall?.[1]).not.toHaveProperty('config');
    expect(JSON.stringify(loggedCall?.[1])).not.toContain('correct-password');
    expect(JSON.stringify(loggedCall?.[1])).not.toContain(credential);
  });
});
