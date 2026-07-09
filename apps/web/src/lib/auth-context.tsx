'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import api from '@/lib/api/client';
import { getDashboardPath, SignupRole } from '@/lib/auth-routing';

interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
  status: string;
  trustLevel?: string | null;
  referralCode?: string | null;
  twoFactorEnabled?: boolean;
  emailVerified?: boolean;
  googleVerified?: boolean;
  hasPassword?: boolean;
}

/** Construct a User from the raw API response data. */
function mapUser(raw: Record<string, unknown>): User {
  return {
    id: raw.id as string,
    email: raw.email as string,
    name: raw.name as string | undefined,
    role: raw.role as string,
    status: (raw.status as string) || 'active',
    trustLevel: (raw.trustLevel as string | null) ?? 'new',
    referralCode: (raw.referralCode as string | null) ?? undefined,
    twoFactorEnabled: (raw.twoFactorEnabled as boolean | undefined) ?? false,
    emailVerified: (raw.emailVerified as boolean | undefined) ?? false,
    googleVerified: (raw.googleVerified as boolean | undefined) ?? false,
    hasPassword: (raw.hasPassword as boolean | undefined) ?? undefined,
  };
}

interface SignupPayload {
  email: string;
  password: string;
  role: SignupRole | string;
  name?: string;
  country?: string;
  referrerCode?: string;
  ageConfirmed?: boolean;
  termsAccepted?: boolean;
  policyVersion?: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, twoFactorToken?: string) => Promise<User>;
  signup: (data: SignupPayload) => Promise<User>;
  googleLogin: (
    idToken: string,
    role?: string,
    twoFactorToken?: string,
    consent?: { ageConfirmed?: boolean; termsAccepted?: boolean; policyVersion?: string },
  ) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Call the same-origin Route Handler `/api/auth/<action>`.
 * The handler sets/clears httpOnly cookies server-side, so no token handling
 * is needed in JavaScript. Returns the parsed JSON body.
 */
async function authFetch(path: string, body: unknown): Promise<unknown> {
  const res = await api.post(path, body);
  return res.data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, call /auth/me. The httpOnly access_token cookie is sent
  // automatically (withCredentials: true). If the cookie is valid, we get
  // the user profile. If 401, the interceptor attempts a refresh; if that
  // also fails, we fall through to logged-out state.
  useEffect(() => {
    api
      .get('/auth/me')
      .then((res) => {
        setUser(res.data as User);
      })
      .catch(() => {
        // Not logged in or session expired — stay logged out.
        // No localStorage to clean up; cookies are httpOnly and cleared
        // by the Route Handler on refresh failure.
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string, twoFactorToken?: string) => {
    const data = (await authFetch('/auth/login', {
      email,
      password,
      ...(twoFactorToken ? { twoFactorToken } : {}),
    })) as { user: Record<string, unknown> };
    // The Route Handler already merged /auth/me into the user profile
    const fullUser = mapUser(data.user);
    localStorage.setItem('lastDashboard', getDashboardPath(fullUser.role));
    setUser(fullUser);
    return fullUser;
  }, []);

  const signup = useCallback(async (payload: SignupPayload) => {
    const data = (await authFetch('/auth/signup', {
      ...payload,
      name: payload.name ?? '',
    })) as { user: Record<string, unknown> };
    const fullUser = mapUser(data.user);
    localStorage.setItem('lastDashboard', getDashboardPath(fullUser.role));
    setUser(fullUser);
    return fullUser;
  }, []);

  const googleLogin = useCallback(async (
    idToken: string,
    role?: string,
    twoFactorToken?: string,
    consent?: { ageConfirmed?: boolean; termsAccepted?: boolean; policyVersion?: string },
  ) => {
    const data = (await authFetch('/auth/google', {
      idToken,
      role: role as 'developer' | 'advertiser' | undefined,
      ...(twoFactorToken ? { twoFactorToken } : {}),
      ...(consent ? { ageConfirmed: consent.ageConfirmed, termsAccepted: consent.termsAccepted, policyVersion: consent.policyVersion } : {}),
    })) as { user: Record<string, unknown> };
    const fullUser = mapUser(data.user);
    localStorage.setItem('lastDashboard', getDashboardPath(fullUser.role));
    setUser(fullUser);
    return fullUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      // Await the Route Handler so the server-side session is actually revoked
      // and the httpOnly cookies are cleared before local state is dropped.
      // If the API/logout Route Handler fails (5xx/502/network), we throw so
      // the caller can surface a retryable error and the user stays visibly
      // authenticated instead of believing logout succeeded while the cookies
      // (and therefore the session) are still alive.
      await api.post('/auth/logout');
      localStorage.removeItem('lastDashboard');
      setUser(null);
    } catch (err: unknown) {
      console.warn('[WaitLayer] logout failed — keeping the session active:', err instanceof Error ? err.message : String(err));
      throw err;
    }
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
