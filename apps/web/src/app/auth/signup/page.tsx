'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [role, setRole] = useState<'developer' | 'advertiser'>('developer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [referrerCode, setReferrerCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signup({ email, password, role, name, referrerCode: referrerCode || undefined });
      const dashboard = localStorage.getItem('lastDashboard') || '/developer';
      router.push(dashboard);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Signup failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-900 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">W</div>
          <span className="text-white font-semibold text-lg">WaitLayer</span>
        </div>

        <div className="bg-ink-800 border border-ink-600/30 rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
          <p className="text-ink-300 text-sm mb-8">Start earning from AI wait time</p>

          {/* Role toggle */}
          <div className="grid grid-cols-2 gap-1 bg-ink-700 p-1 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => setRole('developer')}
              className={`py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                role === 'developer'
                  ? 'bg-ink-600 text-white'
                  : 'text-ink-300 hover:text-white'
              }`}
            >
              Developer
            </button>
            <button
              type="button"
              onClick={() => setRole('advertiser')}
              className={`py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                role === 'advertiser'
                  ? 'bg-ink-600 text-white'
                  : 'text-ink-300 hover:text-white'
              }`}
            >
              Advertiser
            </button>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {role === 'advertiser' && (
              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                  Company name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Company"
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
            )}
            <div>
              <label className="text-ink-200 text-sm font-medium mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
            <div>
              <label className="text-ink-200 text-sm font-medium mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
            {role === 'developer' && (
              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                  Referral code <span className="text-ink-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={referrerCode}
                  onChange={(e) => setReferrerCode(e.target.value)}
                  placeholder="Got an invite code?"
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="text-ink-300 text-sm text-center mt-6">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-brand-500 hover:text-brand-400 transition-colors">
              Sign in
            </Link>
          </p>

          <p className="text-ink-400 text-xs text-center mt-6 leading-relaxed">
            By creating an account, you agree to our Terms of Service and Privacy Policy.
            All ad events are audited. We never read your code or prompts.
          </p>
        </div>
      </div>
    </div>
  );
}