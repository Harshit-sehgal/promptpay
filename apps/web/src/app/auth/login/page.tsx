'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getErrorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth-context';

interface GoogleCredentialResponse {
  credential: string;
}

/**
 * Thick SVGs for the Google "G" mark — rendered inline to avoid fetch.
 * Sizes: 20px (button), 38px (splash card).
 */
function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/** Convert the Google credential response into an idToken and call our API. */
async function handleGoogleCredential(
  credential: string,
  googleLoginFn: (idToken: string) => Promise<unknown>,
): Promise<string | null> {
  try {
    // credential from GIS is the ID token itself
    await googleLoginFn(credential);
    return null;
  } catch (err: unknown) {
    return getErrorMessage(err, 'Google sign-in failed');
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { login, googleLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const googleInitialized = useRef(false);

  const handleMockGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await googleLogin('mock-google-token-developer');
      const dashboard = localStorage.getItem('lastDashboard') || '/developer';
      router.push(dashboard);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Mock Google login failed'));
    } finally {
      setLoading(false);
    }
  };

  // Fetch Auth Config (Google Client ID) at runtime
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002/api/v1';
        const res = await fetch(`${apiUrl}/auth/config`);
        if (res.ok) {
          const data = await res.json();
          if (data.googleClientId) {
            setGoogleClientId(data.googleClientId);
            setGoogleEnabled(true);
          }
        }
      } catch (err) {
        console.error('Failed to load Google Auth config:', err);
      }
    };
    fetchConfig();
  }, []);

  // Initialize Google Identity Services when Client ID is resolved
  useEffect(() => {
    if (!googleClientId || googleInitialized.current) return;

    // Load the GIS script
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
            const errorMsg = await handleGoogleCredential(response.credential, googleLogin);
            setLoading(false);
            if (errorMsg) {
              setError(errorMsg);
            } else {
              const dashboard = localStorage.getItem('lastDashboard') || '/developer';
              router.push(dashboard);
            }
          },
          auto_select: false,
        });
        googleInitialized.current = true;

        // Render button on the element with id="google-signin-btn"
        const btn = document.getElementById('google-signin-btn');
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
      // Cleanup on unmount
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
      await login(email, password);
      const dashboard = localStorage.getItem('lastDashboard') || '/developer';
      router.push(dashboard);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Login failed'));
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
          <h1 className="text-2xl font-bold text-surface-900 mb-1.5 tracking-tight">Welcome back</h1>
          <p className="text-surface-500 text-[14px] mb-8">Sign in to your account</p>

          {error && (
            <div className="bg-red-50 border border-red-200/60 rounded-xl p-3.5 mb-5">
              <p className="text-red-600 text-[14px]">{error}</p>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-surface-700 text-[14px] font-medium block">Password</label>
                <Link
                  href="/auth/forgot-password"
                  className="text-brand-500 hover:text-brand-600 text-[13px] font-medium transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-[14px] transition-colors shadow-sm shadow-brand-500/20"
            >
              {loading ? 'Signing in...' : 'Sign in'}
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
              id="google-signin-btn"
              className="flex justify-center w-full min-h-[44px]"
              data-auto_select="false"
            />
          ) : (
            <button
              disabled
              type="button"
              className="w-full flex items-center justify-center gap-3 bg-surface-50 border border-surface-200/60 text-surface-400 font-medium py-3 rounded-xl text-[14px] opacity-75 cursor-not-allowed"
            >
              <GoogleG size={18} />
              <span>Continue with Google</span>
              <span className="text-[10px] text-surface-300 font-normal">(disabled: client ID missing)</span>
            </button>
          )}

          {(process.env.NEXT_PUBLIC_ALLOW_MOCK_AUTH === 'true' || process.env.NODE_ENV !== 'production') && (
            <button
              onClick={handleMockGoogleLogin}
              type="button"
              className="w-full flex items-center justify-center gap-3 bg-surface-50 hover:bg-surface-100/80 border border-surface-200 text-surface-700 font-semibold py-3 rounded-xl text-[14px] mt-3 transition-all"
            >
              <GoogleG size={18} />
              <span>Continue with Mock Google</span>
            </button>
          )}

          <p className="text-surface-500 text-[14px] text-center mt-7">
            Don't have an account?{' '}
            <Link href="/auth/signup" className="text-brand-500 hover:text-brand-600 font-medium transition-colors">
              Sign up
            </Link>
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
