'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Capture the error in Sentry on the client side
    Sentry.captureException(error);
    if (process.env.NODE_ENV === 'development') {
      console.error(error);
    }
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-6">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-bold text-surface-900 mb-2">Something went wrong</h2>
        <p className="text-surface-500 mb-6">An unexpected error occurred. Please try again.</p>
        <Button variant="brand" onClick={reset} rounded="xl">
          Try again
        </Button>
      </div>
    </div>
  );
}
