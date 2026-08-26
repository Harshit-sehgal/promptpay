'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi } from '@/lib/api/services';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to send reset link'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <div className="mb-10 flex items-center justify-center gap-2.5 lg:hidden">
          <BrandMark />
          <span className="text-surface-900 font-semibold text-sm tracking-tight">Ateva</span>
        </div>

        <div className="rounded-3xl border border-surface-200/70 bg-white p-6 sm:p-8 lg:rounded-none lg:border-0 lg:p-0">
          <h1 className="font-serif text-[26px] font-normal text-surface-950 mb-1.5 tracking-tight">
            Reset your password
          </h1>
          <p className="text-surface-500 text-sm mb-8">
            Enter your account email and we&apos;ll send you a reset link.
          </p>

          {error && (
            <div
              className="bg-red-50 border border-red-200/60 rounded-xl p-3.5 mb-5"
              role="alert"
              aria-live="polite"
            >
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {sent ? (
            <div className="bg-surface-100 border border-surface-200 rounded-xl p-4">
              <p className="text-surface-800 text-sm">
                If an account exists for <span className="font-medium">{email}</span>, a password
                reset link has been sent. The link is valid for 1 hour.
              </p>
            </div>
          ) : (
            <form
              className="space-y-5"
              onSubmit={handleSubmit}
              role="form"
              aria-label="Forgot password form"
            >
              <div>
                <label
                  htmlFor="forgot-password-email"
                  className="text-surface-700 text-sm font-medium mb-1.5 block"
                >
                  Email
                </label>
                <input
                  id="forgot-password-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  inputMode="email"

                  className="w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-900 transition-all placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <Button
                type="submit"
                variant="brand"
                size="lg"
                isLoading={loading}
                disabled={loading}
                className="w-full text-sm"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </Button>
            </form>
          )}

          <p className="text-surface-500 text-sm text-center mt-7">
            Remembered it?{' '}
            <Link
              href="/auth/login"
              className="text-brand-500 hover:text-brand-600 font-medium transition-colors"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
