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
    <div className="min-h-screen flex items-center justify-center bg-ink-900 px-6">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-ink-300 mb-6">An error occurred in the advertiser dashboard. Please try again.</p>
        <button
          onClick={reset}
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 px-6 rounded-xl text-[14px] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
