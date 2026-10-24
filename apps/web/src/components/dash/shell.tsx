import { type ReactNode } from 'react';
import { Sidebar } from '@/components/sidebar';

type NavItem = { label: string; href: string; section?: string };

/** The frame every dashboard shares: the palette-coloured rail and the main
    column. Layouts keep their own guards and providers around it. */
export function DashboardShell({
  workspace,
  navItems,
  modifier,
  children,
}: {
  workspace: string;
  navItems: NavItem[];
  /** Kept as `app-shell--<modifier>` for route-specific rules and tests. */
  modifier: 'developer' | 'advertiser' | 'admin';
  children: ReactNode;
}) {
  return (
    <div className={`app-shell app-shell--${modifier} dash-shell`}>
      <Sidebar brand={workspace} navItems={navItems} />
      <main id="main-content" tabIndex={-1} className="app-shell__main dash-main">
        <div className="dash-main__inner">{children}</div>
      </main>
    </div>
  );
}
