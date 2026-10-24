import type { Metadata } from 'next';

/**
 * Advertiser dashboard shell.
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
  title: { template: '%s · Ateva', default: 'Advertiser · Ateva' },
  description: 'Campaigns, billing and reporting for your Ateva advertiser account.',
  // Defence in depth alongside robots.ts — an authenticated surface.
  robots: { index: false, follow: false },
};

import { DashboardShell } from '@/components/dash';
import { ProtectedRoute } from '@/components/protected-route';
import { StepUpProvider } from '@/components/step-up-provider';

const ADVERTISER_NAV = [
  { label: 'Overview', href: '/advertiser' },
  { label: 'Campaigns', href: '/advertiser/campaigns' },
  { label: 'Create campaign', href: '/advertiser/campaigns/new' },
  { label: 'Reports', href: '/advertiser/reports' },
  { label: 'Billing', href: '/advertiser/billing' },
  { label: 'Settings', href: '/advertiser/settings' },
];

export default function AdvertiserLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['advertiser']}>
      <StepUpProvider>
        <DashboardShell workspace="Advertiser" navItems={ADVERTISER_NAV} modifier="advertiser">
          {children}
        </DashboardShell>
      </StepUpProvider>
    </ProtectedRoute>
  );
}
