'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.error(error);
    }
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-6">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-bold text-surface-900 mb-2">Something went wrong</h2>
        <p className="text-surface-500 mb-6">An error occurred in the developer dashboard. Please try again.</p>
        <button
          onClick={reset}
          className="bg-brand-500 hover:bg-brand-600 text-white font-semibold py-2.5 px-6 rounded-xl text-[14px] transition-colors shadow-sm shadow-brand-500/10"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
