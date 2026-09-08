'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { BrandMark } from './brand-mark';
import { ThemeToggle } from './theme-toggle';

interface SiteHeaderProps {
  primaryHref?: string;
  primaryLabel?: string;
  primaryShortLabel?: string;
  showNavigation?: boolean;
  showLogin?: boolean;
  showThemeToggle?: boolean;
}

const NAV_ITEMS = [
  { label: 'Product', href: '/#product' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Developers', href: '/#developers' },
  { label: 'Sponsors', href: '/#sponsors' },
  { label: 'Trust', href: '/#trust' },
  { label: 'Pricing', href: '/pricing' },
];

/**
 * Shared public navigation.
 *
 * Public pages used to carry small, subtly different copies of the same nav,
 * which made spacing, button radii and mobile behaviour drift between routes.
 * Keep this component deliberately presentation-only so a client page can pass
 * an authenticated dashboard destination without duplicating the chrome.
 */
export function SiteHeader({
  primaryHref,
  primaryLabel,
  primaryShortLabel,
  showNavigation = true,
  showLogin = true,
  showThemeToggle = true,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdvertiserLanding = pathname === '/advertisers';
  const resolvedPrimaryHref =
    primaryHref ??
    (isAdvertiserLanding ? '/advertisers#advertiser-waitlist' : '/auth/signup?role=developer');
  const resolvedPrimaryLabel =
    primaryLabel ?? (isAdvertiserLanding ? 'Join advertiser waitlist' : 'Join developer beta');
  const resolvedPrimaryShortLabel =
    primaryShortLabel ?? (isAdvertiserLanding ? 'Join waitlist' : 'Join beta');
  const currentNavHref =
    pathname === '/pricing' ? '/pricing' : pathname === '/' ? '/#product' : null;

  return (
    <header className="site-header sticky top-0 z-50 border-b border-surface-200/75 bg-white/88 backdrop-blur-xl supports-[backdrop-filter]:bg-white/82">
      <div className="site-header__inner mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Ateva home"
          className="group flex shrink-0 items-center gap-2.5 rounded-full focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-4"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-950 text-white transition-transform duration-300 group-hover:-rotate-3 motion-reduce:transition-none">
            <BrandMark size={16} />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-surface-950">
            Ateva
          </span>
        </Link>

        {showNavigation && (
          <nav aria-label="Primary navigation" className="hidden items-center gap-7 lg:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={currentNavHref === item.href ? 'page' : undefined}
                className={`site-header__nav-link wl-link-u rounded-sm text-[13px] font-medium text-surface-600 transition-colors hover:text-surface-950 ${currentNavHref === item.href ? 'site-header__nav-link--active' : ''}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {showThemeToggle && <ThemeToggle />}
          {showLogin && (
            <Link
              href="/auth/login"
              className="hidden rounded-full px-3.5 py-2 text-[13px] font-medium text-surface-600 transition-colors hover:bg-surface-100 hover:text-surface-950 sm:inline-flex"
            >
              Log in
            </Link>
          )}
          <Link
            href={resolvedPrimaryHref}
            className="site-header__cta inline-flex h-11 items-center rounded-full bg-surface-950 px-4 text-[13px] font-medium text-white transition-colors duration-200 hover:bg-surface-800 sm:h-10 sm:px-5 motion-reduce:transition-none"
          >
            <span className="site-header__cta-label--full">{resolvedPrimaryLabel}</span>
            <span className="site-header__cta-label--short">{resolvedPrimaryShortLabel}</span>
          </Link>
          {showNavigation && (
            <button
              type="button"
              className="site-header__menu-toggle inline-flex h-10 w-10 items-center justify-center rounded-full border border-surface-200 text-surface-700 transition-colors hover:bg-surface-100 hover:text-surface-950 lg:hidden"
              aria-expanded={mobileOpen}
              aria-controls="public-mobile-navigation"
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMobileOpen((open) => !open)}
            >
              <span className="sr-only">{mobileOpen ? 'Close menu' : 'Open menu'}</span>
              <span aria-hidden="true" className="site-header__menu-icon">
                {mobileOpen ? '×' : '≡'}
              </span>
            </button>
          )}
        </div>
      </div>

      {showNavigation && mobileOpen && (
        <nav
          id="public-mobile-navigation"
          aria-label="Mobile primary navigation"
          className="site-header__mobile-nav border-t border-surface-200/75 px-5 pb-5 pt-3 sm:px-6 lg:hidden"
        >
          <div className="mx-auto grid max-w-[1240px] gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={currentNavHref === item.href ? 'page' : undefined}
                className={`site-header__mobile-link rounded-lg px-3 py-2.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 hover:text-surface-950 ${currentNavHref === item.href ? 'site-header__mobile-link--active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            {showLogin && (
              <Link
                href="/auth/login"
                className="site-header__mobile-link mt-2 rounded-lg border-t border-surface-200 px-3 py-3 text-sm font-medium text-surface-700"
                onClick={() => setMobileOpen(false)}
              >
                Log in
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
