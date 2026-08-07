'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { setStepUpPrompt, STEP_UP_LABELS } from '@/lib/api/step-up';

/**
 * Collects an MFA code when the API demands an action-scoped step-up (A-102).
 *
 * Mount once inside each authenticated shell. It installs a prompt handler that
 * the axios interceptor calls when a request is refused with
 * "Step-up authentication is required for this action"; the code is exchanged
 * for a 5-minute action-scoped token and the original request is retried.
 *
 * Before this existed, the entire payout path (register a payout account,
 * request a payout), API key creation, and GDPR account erasure for both roles
 * were permanently 403 from the UI — the API was correct, nothing ever sent the
 * header.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [action, setAction] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const resolverRef = useRef<((value: string | null) => void) | null>(null);

  const settle = useCallback((value: string | null) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setAction(null);
    setCode('');
  }, []);

  useEffect(() => {
    setStepUpPrompt(
      (nextAction: string) =>
        new Promise<string | null>((resolve) => {
          resolverRef.current = resolve;
          setAction(nextAction);
        }),
    );
    return () => {
      // Resolve any in-flight prompt so a pending request cannot hang forever
      // when the shell unmounts (navigation, logout).
      resolverRef.current?.(null);
      resolverRef.current = null;
      setStepUpPrompt(null);
    };
  }, []);

  return (
    <>
      {children}
      {action && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="step-up-title"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-surface-200 bg-white p-6 shadow-xl">
            <h2 id="step-up-title" className="text-base font-semibold text-surface-950">
              Confirm with two-factor authentication
            </h2>
            <p className="mt-1 text-sm leading-6 text-surface-600">
              Enter the 6-digit code from your authenticator app to{' '}
              <strong className="text-surface-900">
                {STEP_UP_LABELS[action] ?? 'complete this action'}
              </strong>
              .
            </p>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) settle(code);
                if (e.key === 'Escape') settle(null);
              }}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Two-factor authentication code"
              className="mt-4 w-full rounded-lg border border-surface-200 px-3 py-2 text-center text-lg tracking-[0.3em] text-surface-900"
            />
            <p className="mt-2 text-xs text-surface-500">
              You can also use a backup code if you cannot reach your authenticator.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => settle(null)}
                className="text-sm font-medium text-surface-500 hover:text-surface-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => settle(code)}
                disabled={code.length < 6}
                className="rounded-lg bg-surface-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-surface-800 disabled:opacity-40"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
