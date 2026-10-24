'use client';

import { RouteError } from '@/components/dash';

export default function BillingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError title="Failed to load billing" actionLabel="Try again" onRetry={reset}>
      {error.message || 'Something went wrong. Please try again.'}
    </RouteError>
  );
}
