'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api/services';
import { getErrorMessage } from '@/lib/api/errors';

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
        setMessage(res.data?.email ? `${res.data.email} is now verified.` : 'Your email is now verified.');
      })
      .catch((err: unknown) => {
        setState('error');
        setMessage(getErrorMessage(err, 'Verification failed — the link may have expired.'));
      });
  }, [token]);

  return (
    <>
      {state === 'verifying' && <p className="text-surface-500 text-[14px]">Verifying your email...</p>}
      {state === 'success' && (
        <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4">
          <p className="text-emerald-700 text-[14px]">{message}</p>
        </div>
      )}
      {state === 'error' && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4">
          <p className="text-red-600 text-[14px]">{message}</p>
        </div>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            W
          </div>
          <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
        </div>

        <div className="bg-white border border-surface-200/80 rounded-2xl p-8 shadow-sm shadow-surface-200/40">
          <h1 className="text-2xl font-bold text-surface-900 mb-6 tracking-tight">Email verification</h1>

          <Suspense fallback={<p className="text-surface-500 text-[14px]">Loading...</p>}>
            <VerifyEmailContent />
          </Suspense>

          <p className="text-surface-500 text-[14px] text-center mt-7">
            <Link href="/auth/login" className="text-brand-500 hover:text-brand-600 font-medium transition-colors">
              Go to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
