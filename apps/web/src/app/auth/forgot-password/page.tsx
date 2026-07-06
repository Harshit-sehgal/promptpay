'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { authApi } from '@/lib/api/services';
import { getErrorMessage } from '@/lib/api/errors';

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
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            W
          </div>
          <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
        </div>

        <div className="bg-white border border-surface-200/80 rounded-2xl p-8 shadow-sm shadow-surface-200/40">
          <h1 className="text-2xl font-bold text-surface-900 mb-1.5 tracking-tight">Reset your password</h1>
          <p className="text-surface-500 text-[14px] mb-8">
            Enter your account email and we&apos;ll send you a reset link.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200/60 rounded-xl p-3.5 mb-5" role="alert" aria-live="polite">
              <p className="text-red-600 text-[14px]">{error}</p>
            </div>
          )}

          {sent ? (
            <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4">
              <p className="text-emerald-700 text-[14px]">
                If an account exists for <span className="font-medium">{email}</span>, a password reset link has
                been sent. The link is valid for 1 hour.
              </p>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit} role="form" aria-label="Forgot password form">
              <div>
                <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  inputMode="email"
                  className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-[14px] transition-colors shadow-sm shadow-brand-500/20"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="text-surface-500 text-[14px] text-center mt-7">
            Remembered it?{' '}
            <Link href="/auth/login" className="text-brand-500 hover:text-brand-600 font-medium transition-colors">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
