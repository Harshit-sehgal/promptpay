'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense,useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi } from '@/lib/api/services';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push('/auth/login'), 2500);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Password reset failed — the link may have expired'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="bg-red-50 border border-red-200/60 rounded-xl p-4">
        <p className="text-red-600 text-[14px]">
          Missing reset token. Please use the link from your email, or{' '}
          <Link href="/auth/forgot-password" className="font-medium underline">
            request a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4">
        <p className="text-emerald-700 text-[14px]">
          Password reset successfully. All sessions were signed out — redirecting you to sign in...
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-3.5 mb-5" role="alert" aria-live="polite">
          <p className="text-red-600 text-[14px]">{error}</p>
        </div>
      )}

      <form className="space-y-5" onSubmit={handleSubmit} role="form" aria-label="Reset password form">
        <div>
          <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">New password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
          />
        </div>
        <div>
          <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">Confirm new password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-[14px] transition-colors shadow-sm shadow-brand-500/20"
        >
          {loading ? 'Resetting...' : 'Reset password'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
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
          <h1 className="text-2xl font-bold text-surface-900 mb-1.5 tracking-tight">Choose a new password</h1>
          <p className="text-surface-500 text-[14px] mb-8">Minimum 8 characters.</p>

          <Suspense fallback={<p className="text-surface-500 text-[14px]">Loading...</p>}>
            <ResetPasswordForm />
          </Suspense>

          <p className="text-surface-500 text-[14px] text-center mt-7">
            <Link href="/auth/login" className="text-brand-500 hover:text-brand-600 font-medium transition-colors">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
