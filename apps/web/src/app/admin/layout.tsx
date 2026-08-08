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
  title: { template: '%s · WaitLayer', default: 'Admin · WaitLayer' },
  description:
    'Operations console for WaitLayer: payouts, fraud review, ledger and platform health.',
  // Defence in depth alongside robots.ts — an authenticated surface.
  robots: { index: false, follow: false },
};

import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';
import { StepUpProvider } from '@/components/step-up-provider';

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
  // A-099: admins need a reachable 2FA enrolment surface. The developer
  // settings page is role-gated, so without this an administrator can never
  // satisfy AdminMfaStepUpGuard and every admin write fails in production.
  { label: 'Account security', href: '/admin/security' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
      <StepUpProvider>
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
      </StepUpProvider>
    </ProtectedRoute>
  );
}
