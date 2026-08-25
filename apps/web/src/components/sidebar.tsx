'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BrandMark } from './brand-mark';
import { LogoutButton } from './logout-button';

interface NavItem {
  label: string;
  href: string;
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

  const isLight = variant === 'light';

  return (
    <aside
      className={`flex w-full shrink-0 flex-col p-4 transition-colors duration-200 sm:p-5 lg:w-[272px] lg:p-6 ${
        isLight
          ? 'bg-surface-50 border-b border-surface-200/80 lg:border-b-0 lg:border-r'
          : 'bg-ink-800 border-b border-ink-600/30 lg:border-b-0 lg:border-r'
      }`}
    >
      <div className="mb-4 flex items-center gap-2.5 lg:mb-9">
        {/*
          The product mark by default. A letter badge is only for a sub-brand
          that must read as distinct from Ateva itself — /admin uses a red "A".
          The default used to be a "W" badge, which kept the pre-rename identity
          on every developer and advertiser dashboard.
        */}
        {brandLetter ? (
          <div
            className={`grid h-9 w-9 place-items-center rounded-full ${brandColor} text-sm font-semibold text-white`}
          >
            {brandLetter}
          </div>
        ) : (
          <div
            className={`grid h-9 w-9 place-items-center rounded-full ${
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
      <nav className="flex gap-2 overflow-x-auto pb-1 lg:block lg:flex-1 lg:space-y-1 lg:overflow-visible lg:pb-0">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-[13px] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                isActive
                  ? isLight
                    ? 'border border-surface-200 bg-white font-medium text-surface-950 shadow-[0_5px_18px_-12px_rgba(23,25,28,0.35)]'
                    : 'bg-white font-medium text-ink-900'
                  : isLight
                    ? 'text-surface-600 hover:text-surface-900 hover:bg-surface-100/50'
                    : 'text-ink-200 hover:text-white hover:bg-ink-700/50'
              } shrink-0 whitespace-nowrap lg:w-full`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div
        className={`mt-4 flex items-start justify-between gap-4 border-t pt-4 lg:block ${
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
