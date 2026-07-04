'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi } from '@/lib/api/services';
import type { SignupRequest } from '@waitlayer/shared';

/** Map user role to their dashboard path */
function getDashboardPath(role: string): string {
  switch (role) {
    case 'advertiser': return '/advertiser';
    case 'admin':
    case 'super_admin': return '/admin';
    default: return '/developer';
  }
}

interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
  status: string;
  trustLevel?: string | null;
  referralCode?: string | null;
}

type SignupRole = 'developer' | 'advertiser';

interface SignupPayload {
  email: string;
  password: string;
  role: SignupRole | string;
  name?: string;
  country?: string;
  referrerCode?: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (data: SignupPayload) => Promise<User>;
  googleLogin: (idToken: string, role?: string) => Promise<User>;
  logout: () => void;
}

/** Max cookie age in seconds (30 days — match JWT refresh TTL). */
const SESSION_COOKIE_MAX_AGE = 2_592_000;

/**
 * Set the session cookie to the real JWT access token. The Next.js
 * middleware verifies this token against JWT_SECRET to gate protected
 * routes — no static sentinel, no bypass.
 *
 * RESTRICTION: max-age≈30 days which mirrors the refresh token TTL;
 * the access token itself is shorter-lived (15 min), so the middleware
 * tolerates an expired token by redirecting to login — the client-side
 * interceptor handles refresh before the redirect completes.
 */
function setSessionCookie(accessToken: string) {
  document.cookie = `session=${accessToken}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax`;
}

function clearSessionCookie() {
  clearSessionCookie();
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      authApi.getMe()
        .then((res) => {
          setUser(res.data);
          // Ensure session cookie is set if we have a valid token
          setSessionCookie(token);
        })
        .catch(() => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          clearSessionCookie();
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    const { accessToken, refreshToken, user: userData } = res.data;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    setSessionCookie(accessToken);
    // /auth/login returns a slim user shape; fetch the full profile so the
    // UI has trustLevel/status/etc. without a second round-trip per page.
    const me = await authApi.getMe();
    const fullUser: User = {
      ...userData,
      status: me.data.status,
      trustLevel: me.data.trustLevel ?? 'new',
      referralCode: me.data.referralCode ?? undefined,
    };
    localStorage.setItem('lastDashboard', getDashboardPath(fullUser.role));
    setUser(fullUser);
    return fullUser;
  }, []);

  const signup = useCallback(async (data: SignupPayload) => {
    const res = await authApi.signup({
      ...data,
      name: data.name ?? '',
    } as SignupRequest);
    const { accessToken, refreshToken, user: userData } = res.data;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    setSessionCookie(accessToken);
    const me = await authApi.getMe();
    const fullUser: User = {
      ...userData,
      status: me.data.status,
      trustLevel: me.data.trustLevel ?? 'new',
      referralCode: me.data.referralCode ?? undefined,
    };
    localStorage.setItem('lastDashboard', getDashboardPath(fullUser.role));
    setUser(fullUser);
    return fullUser;
  }, []);

  const googleLogin = useCallback(async (idToken: string, role?: string) => {
    const res = await authApi.googleLogin({ idToken, role: role as 'developer' | 'advertiser' | undefined });
    const { accessToken, refreshToken, user: userData } = res.data;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    setSessionCookie(accessToken);
    const me = await authApi.getMe();
    const fullUser: User = {
      ...userData,
      status: me.data.status,
      trustLevel: me.data.trustLevel ?? 'new',
      referralCode: me.data.referralCode ?? undefined,
    };
    localStorage.setItem('lastDashboard', getDashboardPath(fullUser.role));
    setUser(fullUser);
    return fullUser;
  }, []);

  const logout = useCallback(() => {
    authApi.logout().catch(() => {});
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('lastDashboard');
    clearSessionCookie();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        googleLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
