'use client';

import { RouteError } from '@/components/dash';

export default function AdminFraudError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError title="Failed to load fraud dashboard" actionLabel="Try again" onRetry={reset}>
      {error.message || 'An unexpected error occurred while loading fraud data. Please try again.'}
    </RouteError>
  );
}
