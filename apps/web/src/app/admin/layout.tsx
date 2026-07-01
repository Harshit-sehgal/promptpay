'use client';

import { useAuth } from '@/lib/auth-context';
import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';

const ADMIN_NAV = [
  { label: 'Overview', href: '/admin' },
  { label: 'Users', href: '/admin/users' },
  { label: 'Campaign approvals', href: '/admin/campaigns' },
  { label: 'Fraud review', href: '/admin/fraud' },
  { label: 'Payout requests', href: '/admin/payouts' },
  { label: 'Ledger / Revenue', href: '/admin/ledger' },
  { label: 'Audit log', href: '/admin/audit' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
      <div className="dark min-h-screen bg-ink-900 flex">
        <Sidebar
          brand="Admin"
          brandLetter="A"
          brandColor="bg-red-500"
          navItems={ADMIN_NAV}
        />
        <main className="flex-1 p-8 overflow-auto">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
