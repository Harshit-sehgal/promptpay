'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageBackdrop } from './motion/page-backdrop';
import { PalettePicker } from './palette-picker';

interface SiteHeaderProps {
  primaryHref?: string;
  primaryLabel?: string;
  primaryShortLabel?: string;
  showNavigation?: boolean;
  showLogin?: boolean;
  showPalettePicker?: boolean;
}

export const NAV_ITEMS = [
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Privacy', href: '/#privacy' },
  { label: 'Sponsors', href: '/#sponsors' },
];

/** The page counts as scrolled once it has moved more than this many pixels. */
const SCROLLED_AFTER_PX = 24;

/**
 * Shared public navigation: an inset sticky bar that is transparent at the top
 * of the page and turns into a frosted-glass pill once the page scrolls.
 *
 * Below 860px only the wordmark, the palette picker and the primary action
 * remain; the text links and Log in are hidden by CSS rather than moved into a
 * menu. Keep this component presentation-only so a client page can pass an
 * authenticated dashboard destination without duplicating the chrome.
 */
export function SiteHeader({
  primaryHref,
  primaryLabel,
  primaryShortLabel,
  showNavigation = true,
  showLogin = true,
  showPalettePicker = true,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const isAdvertiserLanding = pathname === '/advertisers';
  const resolvedPrimaryHref =
    primaryHref ??
    (isAdvertiserLanding ? '/advertisers#advertiser-waitlist' : '/auth/signup?role=developer');
  const resolvedPrimaryLabel =
    primaryLabel ?? (isAdvertiserLanding ? 'Join advertiser waitlist' : 'Join beta');
  const resolvedPrimaryShortLabel =
    primaryShortLabel ?? (isAdvertiserLanding ? 'Join waitlist' : 'Join beta');

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > SCROLLED_AFTER_PX);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <>
      {pathname !== '/' && <PageBackdrop />}
      <header className="site-header" data-scrolled={scrolled ? '' : undefined}>
        <div className="site-header__bar">
          {/* The glass is its own layer, not a style on the bar: a backdrop-filter
              on an ancestor of the picker would make the bar the containing block
              for the picker menu's fixed phone layout. */}
          <span aria-hidden="true" className="site-header__glass backdrop-blur-xl" />

          <Link href="/" aria-label="Ateva home" className="site-header__brand">
            ateva
          </Link>

          {showNavigation && (
            <nav aria-label="Primary navigation" className="site-header__nav">
              {NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} className="site-header__nav-link">
                  {item.label}
                </Link>
              ))}
            </nav>
          )}

          {showLogin && (
            <Link href="/auth/login" className="site-header__nav-link site-header__login">
              Log in
            </Link>
          )}
          {showPalettePicker && <PalettePicker />}
          <Link href={resolvedPrimaryHref} className="site-header__cta">
            <span className="site-header__cta-label--full">{resolvedPrimaryLabel}</span>
            {resolvedPrimaryShortLabel !== resolvedPrimaryLabel && (
              <span className="site-header__cta-label--short">{resolvedPrimaryShortLabel}</span>
            )}
          </Link>
        </div>
      </header>
    </>
  );
}
