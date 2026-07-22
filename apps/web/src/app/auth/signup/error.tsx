'use client';

export default function SignupError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-6">
      <div className="w-full max-w-sm text-center">
        <div className="bg-white border border-surface-200/80 rounded-2xl p-8 shadow-sm shadow-surface-200/40">
          <h2 className="text-xl font-bold text-surface-900 mb-2 tracking-tight">
            Something went wrong
          </h2>
          <p className="text-surface-500 text-sm mb-6">
            An unexpected error occurred while loading the sign-up page.
          </p>
          <button
            onClick={reset}
            className="bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 px-6 rounded-xl text-sm transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
