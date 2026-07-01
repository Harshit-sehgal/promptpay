'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

/** Convert the Google credential response into an idToken and call our API. */
async function handleGoogleCredential(
  credential: string,
  googleLoginFn: (idToken: string, role?: string) => Promise<unknown>,
  role: string,
): Promise<string | null> {
  try {
    // credential from GIS is the ID token itself
    await googleLoginFn(credential, role);
    return null;
  } catch (err: any) {
    return err.response?.data?.message || err.message || 'Google sign-in failed';
  }
}

export default function SignupPage() {
  const router = useRouter();
  const { signup, googleLogin } = useAuth();
  const [role, setRole] = useState<'developer' | 'advertiser'>('developer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [referrerCode, setReferrerCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(!!GOOGLE_CLIENT_ID);
  const googleInitialized = useRef(false);

  // Initialize Google Identity Services for signup
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || googleInitialized.current) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response: any) => {
            setError('');
            setLoading(true);
            const errorMsg = await handleGoogleCredential(response.credential, googleLogin, role);
            setLoading(false);
            if (errorMsg) {
              setError(errorMsg);
            } else {
              const dashboard = localStorage.getItem('lastDashboard') || '/developer';
              router.push(dashboard);
            }
          },
          auto_select: false,
          context: 'signup',
        });
        googleInitialized.current = true;

        const btn = document.getElementById('google-signup-btn');
        if (btn) {
          window.google.accounts.id.renderButton(btn, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            width: btn.clientWidth || 320,
            logo_alignment: 'left',
          });
        }
      }
    };
    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [googleLogin, router]);

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
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            W
          </div>
          <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
        </div>

        <div className="bg-white border border-surface-200/80 rounded-2xl p-8 shadow-sm shadow-surface-200/40">
          <h1 className="text-2xl font-bold text-surface-900 mb-1.5 tracking-tight">Create your account</h1>
          <p className="text-surface-500 text-[14px] mb-8">Start earning from AI wait time</p>

          {/* Role toggle — Notion-style segmented control */}
          <div className="grid grid-cols-2 gap-0.5 bg-surface-100 p-1 rounded-xl mb-7">
            <button
              type="button"
              onClick={() => setRole('developer')}
              className={`py-2.5 px-4 rounded-lg text-[14px] font-medium transition-all ${
                role === 'developer'
                  ? 'bg-white text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              Developer
            </button>
            <button
              type="button"
              onClick={() => setRole('advertiser')}
              className={`py-2.5 px-4 rounded-lg text-[14px] font-medium transition-all ${
                role === 'advertiser'
                  ? 'bg-white text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              Advertiser
            </button>
          </div>

          {/* Google Sign-In */}
          {googleEnabled && (
            <>
              <div
                id="google-signup-btn"
                className="flex justify-center w-full mb-6"
              />
              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 h-px bg-surface-200" />
                <span className="text-surface-400 text-[12px] font-medium uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-surface-200" />
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200/60 rounded-xl p-3.5 mb-5">
              <p className="text-red-600 text-[14px]">{error}</p>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {role === 'advertiser' && (
              <div>
                <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                  Company name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Company"
                  className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
                />
              </div>
            )}
            <div>
              <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
              />
            </div>
            <div>
              <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
              />
            </div>
            {role === 'developer' && (
              <div>
                <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                  Referral code <span className="text-surface-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={referrerCode}
                  onChange={(e) => setReferrerCode(e.target.value)}
                  placeholder="Got an invite code?"
                  className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-[14px] transition-colors shadow-sm shadow-brand-500/20"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="text-surface-500 text-[14px] text-center mt-7">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-brand-500 hover:text-brand-600 font-medium transition-colors">
              Sign in
            </Link>
          </p>

          <p className="text-surface-400 text-[12px] text-center mt-6 leading-relaxed">
            By creating an account, you agree to our Terms of Service and Privacy Policy.
            All ad events are audited. We never read your code or prompts.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Extend window type for Google Identity Services */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}