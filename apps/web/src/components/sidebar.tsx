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
  backLabel = '← Back to home',
  variant = 'dark',
}: SidebarProps) {
  const pathname = usePathname();

  const isLight = variant === 'light';

  return (
    <aside
      className={`w-64 p-6 flex flex-col shrink-0 transition-colors duration-200 ${
        isLight
          ? 'bg-surface-50 border-r border-surface-200/80'
          : 'bg-ink-800 border-r border-ink-600/30'
      }`}
    >
      <div className="flex items-center gap-2 mb-8">
        <div
          className={`w-8 h-8 rounded-lg ${brandColor} flex items-center justify-center text-white font-bold text-sm`}
        >
          {brandLetter}
        </div>
        <span
          className={`font-semibold ${
            isLight ? 'text-surface-900' : 'text-white'
          }`}
        >
          {brand}
        </span>
      </div>
      <nav className="space-y-1 flex-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] transition-all duration-150 ${
                isActive
                  ? isLight
                    ? 'bg-brand-50 border border-brand-200/60 text-brand-600 font-medium'
                    : 'bg-ink-700 text-white'
                  : isLight
                  ? 'text-surface-500 hover:text-surface-900 hover:bg-surface-100/50'
                  : 'text-ink-300 hover:text-white hover:bg-ink-700/50'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div
        className={`pt-4 mt-4 border-t ${
          isLight ? 'border-surface-200/80' : 'border-ink-600/30'
        }`}
      >
        <Link
          href={backHref}
          className={`text-sm transition-colors ${
            isLight ? 'text-surface-400 hover:text-surface-900' : 'text-ink-400 hover:text-white'
          }`}
        >
          {backLabel}
        </Link>
      </div>
    </aside>
  );
}
