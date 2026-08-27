import Link from 'next/link';

import { BrandMark } from './brand-mark';

interface SiteHeaderProps {
  primaryHref?: string;
  primaryLabel?: string;
  showNavigation?: boolean;
  showLogin?: boolean;
}

const NAV_ITEMS = [
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
  primaryHref = '/auth/signup?role=developer',
  primaryLabel = 'Join beta',
  showNavigation = true,
  showLogin = true,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-surface-200/75 bg-white/88 backdrop-blur-xl supports-[backdrop-filter]:bg-white/82">
      <div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-6 lg:px-8">
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
                className="wl-link-u rounded-sm text-[13px] font-medium text-surface-600 transition-colors hover:text-surface-950"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {showLogin && (
            <Link
              href="/auth/login"
              className="hidden rounded-full px-3.5 py-2 text-[13px] font-medium text-surface-600 transition-colors hover:bg-surface-100 hover:text-surface-950 sm:inline-flex"
            >
              Log in
            </Link>
          )}
          <Link
            href={primaryHref}
            className="inline-flex h-11 sm:h-10 items-center rounded-full bg-surface-950 px-5 text-[13px] font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 hover:bg-surface-800 motion-reduce:transform-none motion-reduce:transition-none"
          >
            {primaryLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}
