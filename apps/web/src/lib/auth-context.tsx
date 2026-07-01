'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi } from '@/lib/api/services';

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
  trustLevel: string;
  referralCode?: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (data: any) => Promise<User>;
  googleLogin: (idToken: string, role?: string) => Promise<User>;
  logout: () => void;
}

const SESSION_COOKIE = 'session=1; path=/; max-age=2592000; SameSite=Lax';

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
          document.cookie = SESSION_COOKIE;
        })
        .catch(() => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          document.cookie = 'session=; path=/; max-age=0; SameSite=Lax';
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
    localStorage.setItem('lastDashboard', getDashboardPath(userData.role));
    document.cookie = SESSION_COOKIE;
    setUser(userData);
    return userData;
  }, []);

  const signup = useCallback(async (data: any) => {
    const res = await authApi.signup(data);
    const { accessToken, refreshToken, user: userData } = res.data;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('lastDashboard', getDashboardPath(userData.role));
    document.cookie = SESSION_COOKIE;
    setUser(userData);
    return userData;
  }, []);

  const googleLogin = useCallback(async (idToken: string, role?: string) => {
    const res = await authApi.googleLogin({ idToken, role });
    const { accessToken, refreshToken, user: userData } = res.data;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('lastDashboard', getDashboardPath(userData.role));
    document.cookie = SESSION_COOKIE;
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
    authApi.logout().catch(() => {});
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('lastDashboard');
    document.cookie = 'session=; path=/; max-age=0; SameSite=Lax';
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
