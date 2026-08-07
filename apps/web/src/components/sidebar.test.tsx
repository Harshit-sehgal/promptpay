// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/developer',
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

describe('Sidebar authenticated actions', () => {
  afterEach(() => cleanup());

  it('keeps the shared sign-out control reachable in every responsive shell', () => {
    render(<Sidebar navItems={[{ label: 'Overview', href: '/developer' }]} variant="light" />);

    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut).toBeTruthy();
    expect(signOut.parentElement?.parentElement?.className).not.toContain('hidden');
  });
});
