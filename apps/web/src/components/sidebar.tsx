'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { LogoutButton } from './logout-button';
import { PalettePicker } from './palette-picker';

interface NavItem {
  label: string;
  href: string;
  section?: string;
}

interface SidebarProps {
  /** The workspace name shown beside the wordmark ("Developer", "Admin"). */
  brand?: string;
  /** Accepted for existing call sites; the rail always shows the wordmark. */
  brandLetter?: string;
  brandColor?: string;
  navItems: NavItem[];
  backHref?: string;
  backLabel?: string;
  variant?: 'dark' | 'light';
}

/* The dashboard rail: wordmark and workspace, text navigation with the
   current page as the ink pill, and the palette picker, sign out and the
   way home at the foot. Below lg it collapses to a bar with a menu toggle.
   The glass is its own layer, as in the site header, so the picker menu keeps
   its fixed phone layout. */
export function Sidebar({
  brand = 'Ateva',
  navItems,
  backHref = '/',
  backLabel = 'Back to home',
}: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
    <aside className="app-sidebar dash-rail" data-open={mobileOpen || undefined}>
      <span aria-hidden="true" className="dash-rail__glass" />
      <div className="dash-rail__head">
        <Link href="/" aria-label="Ateva home" className="dash-rail__brand">
          ateva
        </Link>
        {brand !== 'Ateva' && <span className="dash-rail__workspace">{brand}</span>}
        <button
          type="button"
          ref={menuButtonRef}
          className="dash-rail__menu"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar-navigation"
          aria-label={mobileOpen ? 'Close workspace navigation' : 'Open workspace navigation'}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileOpen ? '×' : '≡'}</span>
        </button>
      </div>
      <nav id="app-sidebar-navigation" aria-label="Workspace navigation" className="dash-rail__nav">
        {navItems.map((item, index) => {
          const isActive =
            pathname === item.href ||
            (pathname.startsWith(`${item.href}/`) &&
              !navItems.some(
                (candidate) =>
                  candidate.href !== item.href &&
                  candidate.href.startsWith(`${item.href}/`) &&
                  (pathname === candidate.href || pathname.startsWith(`${candidate.href}/`)),
              ));
          return (
            <div key={item.href}>
              {item.section && item.section !== navItems[index - 1]?.section && (
                <p className="dash-rail__group">{item.section}</p>
              )}
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className="app-sidebar__item dash-rail__item"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>
      <div className="dash-rail__foot">
        <PalettePicker />
        <div className="dash-rail__foot-links">
          <LogoutButton tone="light" />
          <Link href={backHref} className="dash-rail__back">
            {backLabel}
          </Link>
        </div>
      </div>
    </aside>
  );
}
