'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingSpinner } from '@/components/loading-spinner';
import { useAuth } from '@/lib/auth-context';

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: string[];
}) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return <LoadingSpinner size="lg" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900 px-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 max-w-md">
          <h2 className="text-red-400 font-semibold mb-2">Access denied</h2>
          <p className="text-ink-300 text-sm">
            Your account role ({user.role}) does not have access to this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
