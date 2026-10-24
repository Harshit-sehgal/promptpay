// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Sidebar } from './sidebar';

let pathname = '/developer';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

describe('Sidebar authenticated actions', () => {
  afterEach(() => {
    cleanup();
    pathname = '/developer';
  });

  it('keeps the shared sign-out control reachable in every responsive shell', () => {
    render(<Sidebar navItems={[{ label: 'Overview', href: '/developer' }]} variant="light" />);

    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut).toBeTruthy();
    expect(signOut.parentElement?.parentElement?.className).not.toContain('hidden');
  });

  it('marks only the deepest matching nav item as the current page', () => {
    const navItems = [
      { label: 'Overview', href: '/developer' },
      { label: 'Payouts', href: '/developer/payouts' },
    ];
    const current = () =>
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent);

    pathname = '/developer/payouts';
    render(<Sidebar navItems={navItems} />);
    expect(current()).toEqual(['Payouts']);
    cleanup();

    pathname = '/developer/payouts/history';
    render(<Sidebar navItems={navItems} />);
    expect(current()).toEqual(['Payouts']);
    cleanup();

    pathname = '/developer';
    render(<Sidebar navItems={navItems} />);
    expect(current()).toEqual(['Overview']);
  });
});
