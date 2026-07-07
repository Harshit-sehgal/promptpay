'use client';

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-red-400 text-xl font-bold">!</span>
        </div>
        <h2 className="text-white text-lg font-semibold mb-2">Failed to load reports</h2>
        <p className="text-ink-300 text-sm mb-6">
          {error.message || 'An unexpected error occurred while loading report data.'}
        </p>
        <button
          onClick={reset}
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-2.5 rounded-lg transition-colors text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
