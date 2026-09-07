'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';

export interface CurrentUser {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  unitId?: string | null;
  roles: string[];
  permissions: string[];
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: CurrentUser;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
  hasPermission: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem('user');
    const token = localStorage.getItem('accessToken');
    // A user object with no access token (e.g. cleared/expired externally) is
    // not a valid session - treat it as logged out so the guard below redirects.
    if (stored && token) {
      setUser(JSON.parse(stored));
    } else if (stored && !token) {
      localStorage.removeItem('user');
      localStorage.removeItem('refreshToken');
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password });
    localStorage.setItem('accessToken', res.accessToken);
    localStorage.setItem('refreshToken', res.refreshToken);
    localStorage.setItem('user', JSON.stringify(res.user));
    setUser(res.user);
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/login');
  };

  const hasRole = (...roles: string[]) => !!user && user.roles.some((r) => roles.includes(r));
  const hasPermission = (...permissions: string[]) => !!user && (user.permissions ?? []).some((p) => permissions.includes(p));

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasRole, hasPermission }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
