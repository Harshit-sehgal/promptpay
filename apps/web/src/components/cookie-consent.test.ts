// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import { COOKIE_CONSENT_STORAGE_KEY } from '@/lib/consent-preferences';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import CookieConsent from './cookie-consent';

vi.mock('@/lib/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock('@ateva/ui', () => ({
  useToast: () => ({ success: vi.fn() }),
}));

describe('CookieConsent version handling', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  afterEach(() => cleanup());

  it('waits for the required version and re-prompts a stale anonymous choice', async () => {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({ choice: 'accepted', at: '2026-07-01T00:00:00.000Z', version: 'v1' }),
    );

    let resolveVersion!: (value: { data: { marketing_cookies: string } }) => void;
    vi.mocked(api.get).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVersion = resolve;
      }) as never,
    );
    vi.mocked(api.post).mockResolvedValue({} as never);

    render(createElement(CookieConsent));

    expect(screen.queryByRole('dialog', { name: 'Cookie consent' })).toBeNull();
    resolveVersion({ data: { marketing_cookies: 'v2' } });

    expect(await screen.findByRole('dialog', { name: 'Cookie consent' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? '{}',
      ) as { choice?: string; version?: string };
      expect(stored).toMatchObject({ choice: 'accepted', version: 'v2' });
      expect(screen.queryByRole('dialog', { name: 'Cookie consent' })).toBeNull();
    });
    expect(api.post).toHaveBeenCalledWith(
      '/consent/anonymous',
      expect.objectContaining({
        purpose: 'marketing_cookies',
        policyVersion: 'v2',
        granted: true,
      }),
    );
    const postMock = vi.mocked(api.post);
    expect(postMock.mock.calls[0]?.[1]).not.toHaveProperty('version');
  });

  it('withdraws an earlier acceptance when declining while the version cannot be loaded', async () => {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({ choice: 'accepted', at: '2026-10-01T00:00:00.000Z', version: '2026-07-01' }),
    );
    vi.mocked(api.get).mockRejectedValue(new Error('Unavailable'));

    render(createElement(CookieConsent));
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cookie consent' })).toBeNull(),
    );
    const stored = JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? '{}');
    expect(stored).toMatchObject({ choice: 'declined', version: '2026-07-01' });
  });

  it('lets a visitor decline for this session when the required version cannot be loaded', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Unavailable'));

    render(createElement(CookieConsent));

    expect(await screen.findByText('Cookie preferences are temporarily unavailable.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // Accepting needs the policy version to record; declining enables nothing.
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const decline = screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement;
    expect(decline.disabled).toBe(false);

    fireEvent.click(decline);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cookie consent' })).toBeNull(),
    );
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    // The next page in the same session does not re-open it while the version is still down.
    cleanup();
    render(createElement(CookieConsent));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Cookie consent' })).toBeNull();
  });

  it('retries the required-version request without a page reload', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ data: { marketing_cookies: 'v2' } } as never);

    render(createElement(CookieConsent));

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
      expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
  });
});
