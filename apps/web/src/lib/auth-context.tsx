'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import api from '@/lib/api/client';

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
  };
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

  const login = useCallback(async (email: string, password: string) => {
    const data = (await authFetch('/auth/login', { email, password })) as { user: Record<string, unknown> };
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

  const googleLogin = useCallback(async (idToken: string, role?: string) => {
    const data = (await authFetch('/auth/google', {
      idToken,
      role: role as 'developer' | 'advertiser' | undefined,
    })) as { user: Record<string, unknown> };
    const fullUser = mapUser(data.user);
    localStorage.setItem('lastDashboard', getDashboardPath(fullUser.role));
    setUser(fullUser);
    return fullUser;
  }, []);

  const logout = useCallback(() => {
    // Best-effort — call the Route Handler to revoke the server-side session
    // and clear auth cookies.
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('lastDashboard');
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