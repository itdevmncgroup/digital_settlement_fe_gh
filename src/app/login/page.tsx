'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { NavIcon } from '@/components/NavIcons';
import SplashLoader from '@/components/SplashLoader';
import { resolveViewMode, ViewMode, VIEW_STORAGE_KEY } from '@/lib/viewMode';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('desktop');

  // Preselect the saved choice, else the device default (client-only: needs window/localStorage).
  useEffect(() => {
    setViewMode(resolveViewMode());
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
      } catch {
        /* storage blocked - falls back to device default */
      }
      setSignedIn(true);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Keep the branded splash up from a successful login until the destination renders.
  if (signedIn) return <SplashLoader message="Signing you in" />;

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'var(--gradient-brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            marginBottom: 16,
            boxShadow: '0 6px 18px rgba(109, 123, 250, 0.35)',
            color: '#fff',
          }}
        >
          <NavIcon name="logo" />
        </div>
        <h2 className="gradient-text">Digital Settlement</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>Sales Client Entertainment &amp; Expense Management System</p>

        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />

        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <Link href="/forgot-password" className="auth-mobile-link" style={{ margin: 0 }}>
            Forgot password?
          </Link>
        </div>

        <label>View</label>
        <div className="login-view-toggle" role="group" aria-label="View mode">
          {(['mobile', 'desktop'] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>
              {mode === 'mobile' ? 'Mobile' : 'Desktop'}
            </button>
          ))}
        </div>

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', marginTop: 20, justifyContent: 'center' }}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
