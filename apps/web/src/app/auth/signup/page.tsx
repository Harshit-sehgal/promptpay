'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getErrorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth-context';

interface GoogleCredentialResponse {
  credential: string;
}

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
  } catch (err: unknown) {
    return getErrorMessage(err, 'Google sign-in failed');
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
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const googleInitialized = useRef(false);
  const roleRef = useRef(role);

  useEffect(() => {
    const referralFromUrl = new URLSearchParams(window.location.search).get('ref');
    if (referralFromUrl) {
      setReferrerCode(referralFromUrl.trim().toUpperCase());
      setRole('developer');
    }
  }, []);

  // Keep roleRef in sync with role state
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const handleMockGoogleSignup = async () => {
    setError('');
    setLoading(true);
    try {
      await googleLogin('mock-google-token-developer', role);
      const dashboard = localStorage.getItem('lastDashboard') || '/developer';
      router.push(dashboard);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Mock Google signup failed'));
    } finally {
      setLoading(false);
    }
  };

  // Fetch Auth Config (Google Client ID) at runtime. Routed through the
  // same-origin `/api/auth/config` Route Handler so the fetch stays inside
  // CSP `connect-src 'self'` — a direct cross-origin fetch to the API origin
  // would be blocked by CSP in production.
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/auth/config');
        if (res.ok) {
          const data = await res.json();
          if (data.googleClientId) {
            setGoogleClientId(data.googleClientId);
            setGoogleEnabled(true);
          }
        }
      } catch {
        // Silently degrade — Google sign-in button will show as disabled.
        // Logging in dev only to avoid leaking config-fetch errors in production.
      }
    };
    fetchConfig();
  }, []);

  // Initialize Google Identity Services for signup when Client ID is resolved
  useEffect(() => {
    if (!googleClientId || googleInitialized.current) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: GoogleCredentialResponse) => {
            setError('');
            setLoading(true);
            // Use roleRef.current to avoid stale closure
            const errorMsg = await handleGoogleCredential(response.credential, googleLogin, roleRef.current);
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
            width: 320,
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
  }, [googleClientId, googleLogin, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signup({ email, password, role, name, referrerCode: referrerCode || undefined });
      const dashboard = localStorage.getItem('lastDashboard') || '/developer';
      router.push(dashboard);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Signup failed'));
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

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-surface-200" />
            <span className="text-surface-400 text-[11px] font-semibold uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-surface-200" />
          </div>

          {/* Google Sign-In */}
          {googleEnabled ? (
            <div
              id="google-signup-btn"
              className="flex justify-center w-full min-h-[44px]"
            />
          ) : (
            <button
              disabled
              type="button"
              className="w-full flex items-center justify-center gap-3 bg-surface-50 border border-surface-200/60 text-surface-400 font-medium py-3 rounded-xl text-[14px] opacity-75 cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Continue with Google</span>
              <span className="text-[10px] text-surface-300 font-normal">(disabled: client ID missing)</span>
            </button>
          )}

          {process.env.NODE_ENV === 'development' && (

            <button
              onClick={handleMockGoogleSignup}
              type="button"
              className="w-full flex items-center justify-center gap-3 bg-surface-50 hover:bg-surface-100/80 border border-surface-200 text-surface-700 font-semibold py-3 rounded-xl text-[14px] mt-3 transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Continue with Mock Google</span>
            </button>
          )}

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

// Google Identity Services types are declared in `@/types/google.d.ts`
