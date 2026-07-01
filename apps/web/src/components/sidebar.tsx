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
}

export function Sidebar({
  brand = 'WaitLayer',
  brandLetter = 'W',
  brandColor = 'bg-brand-500',
  navItems,
  backHref = '/',
  backLabel = '← Back to home',
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-ink-800 border-r border-ink-600/30 p-6 flex flex-col shrink-0">
      <div className="flex items-center gap-2 mb-8">
        <div className={`w-8 h-8 rounded-lg ${brandColor} flex items-center justify-center text-white font-bold text-sm`}>
          {brandLetter}
        </div>
        <span className="text-white font-semibold">{brand}</span>
      </div>
      <nav className="space-y-1 flex-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === item.href
                ? 'bg-ink-700 text-white'
                : 'text-ink-300 hover:text-white hover:bg-ink-700/50'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-ink-600/30 pt-4 mt-4">
        <Link href={backHref} className="text-ink-400 text-sm hover:text-white transition-colors">
          {backLabel}
        </Link>
      </div>
    </aside>
  );
}
