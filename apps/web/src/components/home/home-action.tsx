'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

/* The homepage's primary action. Signed-in visitors go to their dashboard; the
   server render and signed-out visitors get the beta signup. */
export function HomeAction({ placement }: { placement: 'hero' | 'close' }) {
  const { isAuthenticated, user } = useAuth();
  const signedIn = isAuthenticated && user;

  return (
    <>
      <Link
        className="home-btn"
        href={signedIn ? getDashboardPath(user.role) : '/auth/signup?role=developer'}
      >
        {signedIn ? 'Open dashboard' : 'Join the beta'}
      </Link>
      {placement === 'hero' && !signedIn && (
        <span className="hero-sub">Free · private beta · VS Code</span>
      )}
    </>
  );
}
