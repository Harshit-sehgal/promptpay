'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
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
        <p className="text-red-600 text-sm">
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
        <p className="text-emerald-700 text-sm">
          Password reset successfully. All sessions were signed out — redirecting you to sign in...
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div
          className="bg-red-50 border border-red-200/60 rounded-xl p-3.5 mb-5"
          role="alert"
          aria-live="polite"
        >
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      <form
        className="space-y-5"
        onSubmit={handleSubmit}
        role="form"
        aria-label="Reset password form"
      >
        <div>
          <label
            htmlFor="reset-password-new"
            className="text-surface-700 text-sm font-medium mb-1.5 block"
          >
            New password
          </label>
          <input
            id="reset-password-new"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete="new-password"

            className="w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-900 transition-all placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <label
            htmlFor="reset-password-confirm"
            className="text-surface-700 text-sm font-medium mb-1.5 block"
          >
            Confirm new password
          </label>
          <input
            id="reset-password-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete="new-password"

            className="w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-900 transition-all placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <Button
          type="submit"
          variant="brand"
          size="lg"
          isLoading={loading}
          disabled={loading}
          className="w-full rounded-xl text-sm"
        >
          {loading ? 'Resetting...' : 'Reset password'}
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen flex items-center justify-center bg-surface-50 px-6"
    >
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            W
          </div>
          <span className="text-surface-900 font-semibold text-sm tracking-tight">WaitLayer</span>
        </div>

        <div className="bg-white border border-surface-200/80 rounded-2xl p-8 shadow-sm shadow-surface-200/40">
          <h1 className="text-2xl font-bold text-surface-900 mb-1.5 tracking-tight">
            Choose a new password
          </h1>
          <p className="text-surface-500 text-sm mb-8">Minimum 8 characters.</p>

          <Suspense fallback={<p className="text-surface-500 text-sm">Loading...</p>}>
            <ResetPasswordForm />
          </Suspense>

          <p className="text-surface-500 text-sm text-center mt-7">
            <Link
              href="/auth/login"
              className="text-brand-500 hover:text-brand-600 font-medium transition-colors"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
