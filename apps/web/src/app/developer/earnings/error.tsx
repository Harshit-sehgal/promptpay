'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import * as Sentry from '@sentry/nextjs';

export default function DevEarningsError({
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
    <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-surface-900 mb-2">Something went wrong</h2>
        <p className="text-surface-500 text-sm mb-6">Failed to load earnings data.</p>
        <Button variant="brand" onClick={reset} rounded="xl">
          Try again
        </Button>
      </div>
    </div>
  );
}
