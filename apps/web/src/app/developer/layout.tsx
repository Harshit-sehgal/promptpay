'use client';

import { LaunchModeBanner } from '@/components/launch-mode-banner';
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
      <div className="min-h-screen bg-slate-50/50 flex flex-col lg:flex-row">
        <Sidebar navItems={DEVELOPER_NAV} variant="light" />
        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          {/* A-089: every developer surface states the settlement mode. Placed in
              the layout rather than per-page so a new page cannot silently ship
              without the disclosure. */}
          <LaunchModeBanner />
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
