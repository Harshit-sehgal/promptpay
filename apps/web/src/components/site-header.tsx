'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { type ColorField, ColorFields } from './motion/color-fields';
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

/* The fixed backdrop behind every public page except the homepage, which
   places its own fields per section. The parent is the viewport, so the
   parallax offset stays at zero; the speeds only matter if that changes. */
const PAGE_FIELDS: ColorField[] = [
  { color: 1, size: 640, x: '-14%', y: '-12%', speed: 0.04 },
  { color: 2, size: 560, x: '64%', y: '14%', speed: 0.05 },
  { color: 3, size: 600, x: '20%', y: '62%', speed: 0.03 },
];

/** Fixed palette colour fields behind a public page's content. */
export function PageBackdrop() {
  return (
    <div aria-hidden="true" className="page-backdrop">
      <ColorFields fields={PAGE_FIELDS} />
    </div>
  );
}

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
