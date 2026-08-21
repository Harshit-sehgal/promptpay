import type { Metadata } from 'next';

/**
 * Developer dashboard shell.
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
  title: { template: '%s · Ateva', default: 'Developer · Ateva' },
  description: 'Earnings, payouts, referrals and trust for your Ateva developer account.',
  // Defence in depth alongside robots.ts — an authenticated surface.
  robots: { index: false, follow: false },
};

import { LaunchModeBanner } from '@/components/launch-mode-banner';
import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';
import { StepUpProvider } from '@/components/step-up-provider';

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
      <StepUpProvider>
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
      </StepUpProvider>
    </ProtectedRoute>
  );
}
