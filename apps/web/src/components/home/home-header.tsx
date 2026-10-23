'use client';

import { SiteHeader } from '@/components/site-header';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

/* The homepage is a server component, so the auth-aware header props are
   computed here. */
export function HomeHeader() {
  const { isAuthenticated, user } = useAuth();
  const signedIn = isAuthenticated && !!user;

  return (
    <SiteHeader
      primaryHref={signedIn ? getDashboardPath(user?.role) : '/auth/signup?role=developer'}
      primaryLabel={signedIn ? 'Open dashboard' : 'Join beta'}
      primaryShortLabel={signedIn ? 'Dashboard' : 'Join beta'}
      showLogin={!signedIn}
    />
  );
}
