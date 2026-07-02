'use client';

import { ProtectedRoute } from '@/components/protected-route';
import { Sidebar } from '@/components/sidebar';

const ADVERTISER_NAV = [
  { label: 'Overview', href: '/advertiser' },
  { label: 'Campaigns', href: '/advertiser/campaigns' },
  { label: 'Create campaign', href: '/advertiser/campaigns/new' },
  { label: 'Reports', href: '/advertiser/reports' },
  { label: 'Billing', href: '/advertiser/billing' },
];

export default function AdvertiserLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['advertiser']}>
      <div className="dark min-h-screen bg-ink-900 flex flex-col lg:flex-row">
        <Sidebar
          brand="WaitLayer"
          brandLetter="W"
          brandColor="bg-brand-500"
          navItems={ADVERTISER_NAV}
        />
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
