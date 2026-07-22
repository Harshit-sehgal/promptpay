'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
  brand = 'WaitLayer',
  brandLetter = 'W',
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
      className={`w-full lg:w-64 p-4 sm:p-6 flex flex-col shrink-0 transition-colors duration-200 ${
        isLight
          ? 'bg-surface-50 border-b border-surface-200/80 lg:border-b-0 lg:border-r'
          : 'bg-ink-800 border-b border-ink-600/30 lg:border-b-0 lg:border-r'
      }`}
    >
      <div className="flex items-center gap-2 mb-4 lg:mb-8">
        <div
          className={`w-8 h-8 rounded-lg ${brandColor} flex items-center justify-center text-white font-bold text-sm`}
        >
          {brandLetter}
        </div>
        <span className={`font-semibold ${isLight ? 'text-surface-900' : 'text-white'}`}>
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
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                isActive
                  ? isLight
                    ? 'bg-brand-50 border border-brand-200/60 text-brand-700 font-medium'
                    : 'bg-ink-700 text-white'
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
        className={`hidden lg:block pt-4 mt-4 border-t ${
          isLight ? 'border-surface-200/80' : 'border-ink-600/30'
        }`}
      >
        <Link
          href={backHref}
          className={`text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 rounded ${
            isLight ? 'text-surface-500 hover:text-surface-900' : 'text-ink-300 hover:text-white'
          }`}
        >
          {backLabel}
        </Link>
      </div>
    </aside>
  );
}
