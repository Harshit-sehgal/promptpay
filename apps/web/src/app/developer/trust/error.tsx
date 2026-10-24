'use client';

import { useEffect } from 'react';
import { RouteError } from '@/components/dash';
import * as Sentry from '@sentry/nextjs';

export default function DevTrustError({
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
    <RouteError title="Something went wrong" actionLabel="Try again" onRetry={reset}>
      Failed to load trust information.
    </RouteError>
  );
}
