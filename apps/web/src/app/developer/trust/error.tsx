'use client';

export default function DevTrustError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-surface-900 mb-2">Something went wrong</h2>
        <p className="text-surface-500 text-sm mb-6">Failed to load trust information.</p>
        <button
          onClick={reset}
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 px-6 rounded-xl text-sm transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
