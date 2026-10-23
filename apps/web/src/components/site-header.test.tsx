// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { SiteHeader } from './site-header';

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { value, configurable: true });
  act(() => {
    fireEvent.scroll(window);
  });
}

describe('SiteHeader', () => {
  beforeEach(() => {
    setScrollY(0);
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('links the three homepage sections, the palette picker and the join button', () => {
    render(<SiteHeader />);

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const hrefs = Array.from(nav.querySelectorAll('a')).map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(hrefs).toEqual([
      ['How it works', '/#how-it-works'],
      ['Privacy', '/#privacy'],
      ['Sponsors', '/#sponsors'],
    ]);
    expect(screen.getByRole('button', { name: /^Background/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Join beta' }).getAttribute('href')).toBe(
      '/auth/signup?role=developer',
    );
  });

  it('has no mobile menu: narrow screens just hide the text links', () => {
    render(<SiteHeader />);
    expect(screen.queryByRole('button', { name: /navigation menu/i })).toBeNull();
  });

  it('shows Log in only when asked to', () => {
    const { rerender } = render(<SiteHeader showLogin />);
    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();

    rerender(<SiteHeader showLogin={false} />);
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
  });

  it('can leave the palette picker out', () => {
    render(<SiteHeader showPalettePicker={false} />);
    expect(screen.queryByRole('button', { name: /^Background/ })).toBeNull();
  });

  it('turns to glass once the page has scrolled past 24px', () => {
    const { container } = render(<SiteHeader />);
    const header = container.querySelector('header')!;
    expect(header.hasAttribute('data-scrolled')).toBe(false);

    setScrollY(24);
    expect(header.hasAttribute('data-scrolled')).toBe(false);

    setScrollY(30);
    expect(header.hasAttribute('data-scrolled')).toBe(true);

    setScrollY(0);
    expect(header.hasAttribute('data-scrolled')).toBe(false);
  });

  it('sets the glass state on load when the page is restored part-way down', () => {
    setScrollY(400);
    const { container } = render(<SiteHeader />);
    expect(container.querySelector('header')!.hasAttribute('data-scrolled')).toBe(true);
  });
});
