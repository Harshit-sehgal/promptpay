'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { BrandMark } from '@/components/brand-mark';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi } from '@/lib/api/services';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [state, setState] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('Missing verification token. Please use the link from your email.');
      return;
    }
    if (attempted.current) return;
    attempted.current = true;

    authApi
      .confirmEmailVerification(token)
      .then((res) => {
        setState('success');
        setMessage(
          res.data?.email ? `${res.data.email} is now verified.` : 'Your email is now verified.',
        );
      })
      .catch((err: unknown) => {
        setState('error');
        setMessage(getErrorMessage(err, 'Verification failed — the link may have expired.'));
      });
  }, [token]);

  return (
    <>
      {state === 'verifying' && <p className="text-surface-500 text-sm">Verifying your email...</p>}
      {state === 'success' && (
        <div className="bg-surface-100 border border-surface-200 rounded-xl p-4">
          <p className="text-surface-800 text-sm">{message}</p>
        </div>
      )}
      {state === 'error' && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4">
          {/* red-600 on the red-50 panel measures 4.36:1 — just under the 4.5:1
              WCAG AA threshold, which is exactly the kind of near-miss no one
              catches by eye. red-700 clears it at 5.91:1. */}
          <p className="text-red-700 text-sm">{message}</p>
        </div>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <div className="mb-10 flex items-center justify-center gap-2.5 lg:hidden">
          <BrandMark />
          <span className="text-surface-900 font-semibold text-sm tracking-tight">Ateva</span>
        </div>

        <div className="rounded-3xl border border-surface-200/70 bg-white p-6 sm:p-8 lg:rounded-none lg:border-0 lg:p-0">
          <h1 className="mb-6 font-serif text-[26px] font-normal tracking-tight text-surface-950">
            Email verification
          </h1>

          <Suspense fallback={<p className="text-surface-500 text-sm">Loading...</p>}>
            <VerifyEmailContent />
          </Suspense>

          <p className="text-surface-500 text-sm text-center mt-7">
            <Link
              href="/auth/login"
              className="text-brand-500 hover:text-brand-600 font-medium transition-colors"
            >
              Go to sign in
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
