'use client';

import { RouteError } from '@/components/dash';

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError title="Failed to load reports" actionLabel="Try again" onRetry={reset}>
      {error.message || 'An unexpected error occurred while loading report data.'}
    </RouteError>
  );
}
