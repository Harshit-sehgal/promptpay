'use client';

import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';

const ADMIN_NAV = [
  { label: 'Overview', href: '/admin' },
  { label: 'Metrics', href: '/admin/metrics' },
  { label: 'Users', href: '/admin/users' },
  { label: 'Campaign approvals', href: '/admin/campaigns' },
  { label: 'Fraud review', href: '/admin/fraud' },
  { label: 'Device recovery', href: '/admin/devices' },
  { label: 'Payout requests', href: '/admin/payouts' },
  { label: 'Fenced payout accounts', href: '/admin/payouts/fenced' },
  { label: 'Recovery debt', href: '/admin/recovery-debt' },
  { label: 'Ledger / Revenue', href: '/admin/ledger' },
  { label: 'Operations', href: '/admin/operations' },
  { label: 'Audit log', href: '/admin/audit' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
      {/* Admin surfaces are authenticated and must never be indexed by search
          engines or appear in sitemaps. */}
      <meta name="robots" content="noindex, nofollow" />
      <div className="dark min-h-screen bg-ink-900 flex flex-col lg:flex-row">
        <Sidebar brand="Admin" brandLetter="A" brandColor="bg-red-500" navItems={ADMIN_NAV} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-auto"
        >
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
