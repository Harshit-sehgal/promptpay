'use client';

import { useEffect } from 'react';
import { RouteError } from '@/components/dash';
import * as Sentry from '@sentry/nextjs';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    if (process.env.NODE_ENV === 'development') {
      console.error(error);
    }
  }, [error]);

  return (
    <RouteError title="Failed to load this section" actionLabel="Reload view" onRetry={reset}>
      There was an error loading this dashboard view.
    </RouteError>
  );
}
