'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import BrandLogo from '@/components/BrandLogo';
import SplashLoader from '@/components/SplashLoader';
import { resolveViewMode, ViewMode, VIEW_STORAGE_KEY } from '@/lib/viewMode';
import { clearLoggedOutMark, safeNextPath } from '@/lib/loginRedirect';

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
    clearLoggedOutMark();
    // Arriving from an email's "Mobile Mode" link: preselect the phone view.
    const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    setViewMode(next && /[?&]view=mobile/.test(next) ? 'mobile' : resolveViewMode());
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
      // A deep link (e.g. from an email) brought us here: continue to it instead of the landing page.
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get('next')) ?? '/');
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
        <div style={{ marginBottom: 16 }}>
          <BrandLogo height={56} />
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
