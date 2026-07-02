'use client';

import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';

const DEVELOPER_NAV = [
  { label: 'Overview', href: '/developer' },
  { label: 'Earnings', href: '/developer/earnings' },
  { label: 'Payouts', href: '/developer/payouts' },
  { label: 'Referrals', href: '/developer/referral' },
  { label: 'Trust & Fraud', href: '/developer/trust' },
  { label: 'Settings', href: '/developer/settings' },
];

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['developer']}>
      <div className="min-h-screen bg-slate-50/50 flex">
        <Sidebar navItems={DEVELOPER_NAV} variant="light" />
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
