import type { Metadata } from 'next';

/**
 * Admin console shell.
 *
 * Deliberately a Server Component. It has no hooks and no event handlers —
 * it only composes client children, which a Server Component may do — and
 * dropping `'use client'` is what allows it to export `metadata`. While it
 * was a Client Component every page beneath it inherited the root layout's
 * marketing title, so a user with several tabs open saw the same string on
 * all of them.
 *
 * `title.template` lets any future Server Component page below set its own
 * title and have it suffixed consistently.
 */
export const metadata: Metadata = {
  title: { template: '%s · Ateva', default: 'Admin · Ateva' },
  description: 'Operations console for Ateva: payouts, fraud review, ledger and platform health.',
  // Defence in depth alongside robots.ts — an authenticated surface.
  robots: { index: false, follow: false },
};

import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';
import { StepUpProvider } from '@/components/step-up-provider';

const ADMIN_NAV = [
  { label: 'Overview', href: '/admin', section: 'Overview' },
  { label: 'Metrics', href: '/admin/metrics', section: 'Operations' },
  { label: 'Operations', href: '/admin/operations', section: 'Operations' },
  { label: 'Audit log', href: '/admin/audit', section: 'Operations' },
  { label: 'Users', href: '/admin/users', section: 'People' },
  { label: 'Waitlist', href: '/admin/waitlist', section: 'People' },
  { label: 'Campaign approvals', href: '/admin/campaigns', section: 'Campaigns' },
  { label: 'Fraud review', href: '/admin/fraud', section: 'Risk' },
  { label: 'Device recovery', href: '/admin/devices', section: 'Risk' },
  { label: 'Payout requests', href: '/admin/payouts', section: 'Money' },
  { label: 'Fenced payout accounts', href: '/admin/payouts/fenced', section: 'Money' },
  { label: 'Recovery debt', href: '/admin/recovery-debt', section: 'Money' },
  { label: 'Ledger / Revenue', href: '/admin/ledger', section: 'Money' },
  // A-099: admins need a reachable 2FA enrolment surface. The developer
  // settings page is role-gated, so without this an administrator can never
  // satisfy AdminMfaStepUpGuard and every admin write fails in production.
  { label: 'Account security', href: '/admin/security', section: 'Account' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
      <StepUpProvider>
        {/* Admin surfaces are authenticated and must never be indexed by search
          engines or appear in sitemaps. */}
        <meta name="robots" content="noindex, nofollow" />
        <div className="app-shell app-shell--admin min-h-screen bg-ink-900 flex flex-col lg:flex-row">
          <Sidebar brand="Admin" navItems={ADMIN_NAV} />
          <main
            id="main-content"
            tabIndex={-1}
            className="app-shell__main flex-1 min-w-0 overflow-auto p-4 sm:p-6 lg:p-8"
          >
            {children}
          </main>
        </div>
      </StepUpProvider>
    </ProtectedRoute>
  );
}
