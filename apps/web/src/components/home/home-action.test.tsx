// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardPath } from '@/lib/auth-routing';
import { cleanup, render, screen } from '@testing-library/react';

import { HomeAction } from './home-action';

const { auth } = vi.hoisted(() => ({
  auth: { current: { isAuthenticated: false, user: null as { role: string } | null } },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => auth.current,
}));

describe('HomeAction', () => {
  afterEach(() => {
    cleanup();
    auth.current = { isAuthenticated: false, user: null };
  });

  it('invites a signed-out visitor to join the beta', () => {
    render(<HomeAction placement="hero" />);

    const link = screen.getByRole('link', { name: 'Join the beta' });
    expect(link.getAttribute('href')).toBe('/auth/signup?role=developer');
    expect(screen.getByText('Free · private beta · VS Code')).toBeTruthy();
  });

  it('keeps the close placement to the button alone', () => {
    render(<HomeAction placement="close" />);

    expect(screen.getByRole('link', { name: 'Join the beta' })).toBeTruthy();
    expect(screen.queryByText('Free · private beta · VS Code')).toBeNull();
  });

  it('sends a signed-in visitor to their dashboard', () => {
    auth.current = { isAuthenticated: true, user: { role: 'advertiser' } };
    render(<HomeAction placement="hero" />);

    const link = screen.getByRole('link', { name: 'Open dashboard' });
    expect(link.getAttribute('href')).toBe(getDashboardPath('advertiser'));
    expect(screen.queryByText('Free · private beta · VS Code')).toBeNull();
  });
});
