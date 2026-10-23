'use client';

import { SiteHeader } from '@/components/site-header';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

/* The homepage is a server component, so the auth-aware header props are
   computed here. */
export function HomeHeader() {
  const { isAuthenticated, user } = useAuth();

  return (
    <SiteHeader
      primaryHref={
        isAuthenticated && user ? getDashboardPath(user.role) : '/auth/signup?role=developer'
      }
      primaryLabel={isAuthenticated ? 'Open dashboard' : 'Join beta'}
      primaryShortLabel={isAuthenticated ? 'Dashboard' : 'Join beta'}
      showLogin={!isAuthenticated}
    />
  );
}
