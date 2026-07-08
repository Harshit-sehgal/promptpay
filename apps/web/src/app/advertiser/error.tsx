'use client';

import { useEffect } from 'react';
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
    <div className="py-12 px-6 flex items-center justify-center bg-surface-50 rounded-2xl border border-surface-200">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-bold text-surface-900 mb-2">Failed to load this section</h2>
        <p className="text-surface-500 text-sm mb-6">
          There was an error loading this dashboard view.
        </p>
        <button
          onClick={reset}
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium py-2 px-5 rounded-xl text-[13px] transition-colors"
        >
          Reload view
        </button>
      </div>
    </div>
  );
}
