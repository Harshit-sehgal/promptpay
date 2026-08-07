// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LogoutButton } from './logout-button';

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ logout }),
}));

describe('LogoutButton', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('waits for server-confirmed logout before leaving the protected shell', async () => {
    const redirect = vi.fn();
    logout.mockResolvedValue(undefined);
    render(<LogoutButton tone="light" redirectAfterLogout={redirect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(redirect).toHaveBeenCalledWith('/auth/login');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the user in place and surfaces a retryable error when logout fails', async () => {
    const redirect = vi.fn();
    logout.mockRejectedValue(new Error('upstream unavailable'));
    render(<LogoutButton redirectAfterLogout={redirect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toContain('upstream unavailable');
    expect(redirect).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
