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

vi.mock('@waitlayer/ui', () => ({
  useToast: () => ({ success: vi.fn() }),
}));

describe('CookieConsent version handling', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
  });

  it('keeps choices disabled when the required version cannot be loaded', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Unavailable'));

    render(createElement(CookieConsent));

    expect(await screen.findByText('Cookie preferences are temporarily unavailable.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBeNull();
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
