'use client';

import type { ReactNode } from 'react';

import { AuthShell } from './auth-shell';
import { LoadingSpinner } from './loading-spinner';

/**
 * Route-level auth states use the same shell as the actual forms. Keeping the
 * frame present during a streamed/loading/error state prevents a jarring
 * full-viewport style switch and keeps the recovery action predictable.
 */
export function AuthLoadingState({ label = 'Loading account access' }: { label?: string }) {
  return (
    <AuthShell>
      <div className="flex min-h-[320px] items-center justify-center" aria-label={label}>
        <LoadingSpinner size="md" />
      </div>
    </AuthShell>
  );
}

export function AuthErrorState({
  description,
  reset,
}: {
  description: ReactNode;
  reset: () => void;
}) {
  return (
    <AuthShell>
      <div className="mx-auto w-full max-w-sm text-center">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-600">
          Account access
        </p>
        <h1 className="mt-4 font-serif text-4xl font-normal leading-none tracking-[-0.035em] text-surface-950">
          Something went wrong
        </h1>
        <p className="mt-4 text-sm leading-6 text-surface-600">{description}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-7 inline-flex h-11 items-center justify-center rounded-full bg-surface-950 px-5 text-sm font-medium text-white transition-colors hover:bg-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Try again{' '}
          <span aria-hidden="true" className="ml-2">
            →
          </span>
        </button>
      </div>
    </AuthShell>
  );
}
