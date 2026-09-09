'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BrandMark } from './brand-mark';
import { LogoutButton } from './logout-button';
import { ThemeToggle } from './theme-toggle';

interface NavItem {
  label: string;
  href: string;
  section?: string;
}

interface SidebarProps {
  brand?: string;
  brandLetter?: string;
  brandColor?: string;
  navItems: NavItem[];
  backHref?: string;
  backLabel?: string;
  variant?: 'dark' | 'light';
}

export function Sidebar({
  brand = 'Ateva',
  brandLetter,
  brandColor = 'bg-brand-500',
  navItems,
  backHref = '/',
  backLabel = 'Back to home',
  variant = 'dark',
}: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const isLight = variant === 'light';

  useEffect(() => {
    if (!mobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      menuButtonRef.current?.focus();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  return (
    <aside
      className={`app-sidebar app-sidebar--${variant} flex w-full shrink-0 flex-col p-4 transition-colors duration-200 sm:p-5 lg:w-[272px] lg:p-6 ${
        isLight
          ? 'bg-surface-50 border-b border-surface-200/80 lg:border-b-0 lg:border-r'
          : 'bg-ink-800 border-b border-ink-600/30 lg:border-b-0 lg:border-r'
      }`}
    >
      <div className="app-sidebar__header mb-4 flex items-center justify-between gap-3 lg:mb-9">
        <div className="flex min-w-0 items-center gap-2.5">
          {/*
          The product mark by default. A letter badge is only for a sub-brand
          that must read as distinct from Ateva itself — /admin uses a red "A".
          The default used to be a "W" badge, which kept the pre-rename identity
          on every developer and advertiser dashboard.
        */}
          {brandLetter ? (
            <div
              className={`app-sidebar__mark grid h-9 w-9 place-items-center rounded-full ${brandColor} text-sm font-semibold text-white`}
            >
              {brandLetter}
            </div>
          ) : (
            <div
              className={`app-sidebar__mark grid h-9 w-9 place-items-center rounded-full ${
                isLight ? 'bg-surface-950 text-white' : 'bg-white text-ink-900'
              }`}
            >
              <BrandMark size={17} />
            </div>
          )}
          <span
            className={`text-[15px] font-semibold tracking-[-0.02em] ${isLight ? 'text-surface-900' : 'text-white'}`}
          >
            {brand}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            ref={menuButtonRef}
            className="app-sidebar__menu-toggle inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="app-sidebar-navigation"
            aria-label={mobileOpen ? 'Close workspace navigation' : 'Open workspace navigation'}
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span aria-hidden="true">{mobileOpen ? '×' : '≡'}</span>
          </button>
        </div>
      </div>
      <nav
        id="app-sidebar-navigation"
        aria-label="Workspace navigation"
        className={`app-sidebar__nav gap-1 overflow-y-auto pb-1 lg:block lg:flex-1 lg:space-y-1 lg:overflow-visible lg:pb-0 ${mobileOpen ? 'flex' : 'hidden'} flex-col`}
      >
        {navItems.map((item, index) => {
          const isActive =
            pathname === item.href ||
            (pathname.startsWith(`${item.href}/`) &&
              !navItems.some(
                (candidate) =>
                  candidate.href !== item.href && pathname.startsWith(`${candidate.href}/`),
              ));
          return (
            <div key={item.href}>
              {item.section && item.section !== navItems[index - 1]?.section && (
                <p className="app-sidebar__group-label mt-5 px-3.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] first:mt-0">
                  {item.section}
                </p>
              )}
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`app-sidebar__item flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-[13px] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                  isActive
                    ? isLight
                      ? 'app-sidebar__item--active border border-surface-200 bg-white font-medium text-surface-950 shadow-[0_5px_18px_-12px_rgba(23,25,28,0.35)]'
                      : 'app-sidebar__item--active bg-white font-medium text-ink-900'
                    : isLight
                      ? 'text-surface-600 hover:text-surface-900 hover:bg-surface-100/50'
                      : 'text-ink-200 hover:text-white hover:bg-ink-700/50'
                } whitespace-nowrap lg:w-full`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>
      <div
        className={`app-sidebar__footer mt-4 flex items-start justify-between gap-4 border-t pt-4 lg:block ${
          isLight ? 'border-surface-200/80' : 'border-ink-600/30'
        }`}
      >
        <LogoutButton tone={isLight ? 'light' : 'dark'} />
        <Link
          href={backHref}
          className={`rounded text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 lg:mt-2 lg:block ${
            isLight ? 'text-surface-500 hover:text-surface-900' : 'text-ink-300 hover:text-white'
          }`}
        >
          {backLabel}
        </Link>
      </div>
    </aside>
  );
}
