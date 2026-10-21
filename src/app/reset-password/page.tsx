'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import AuthMobileLayout from '@/components/AuthMobileLayout';

const MIN_LENGTH = 8;

// Public page opened from the forgot-password email (mobile browser first, see
// AuthMobileLayout). The token in the URL is the only credential. After a
// successful reset any session in this browser is dropped and the user is sent
// to /login - the backend likewise refuses refresh tokens issued before the reset.
function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [checking, setChecking] = useState(true);
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLinkError('This reset link is invalid. Please request a new one.');
      setChecking(false);
      return;
    }
    api
      .get(`/auth/reset-password/${encodeURIComponent(token)}`)
      .catch((err) => setLinkError(err instanceof ApiError ? err.message : 'Could not verify this link. Please try again.'))
      .finally(() => setChecking(false));
  }, [token]);

  // Back to the login screen shortly after success; the button does it right away.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.replace('/login'), 3000);
    return () => clearTimeout(timer);
  }, [done, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      try {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
      } catch {
        /* storage blocked - nothing to clear */
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <AuthMobileLayout title="Reset password">
        <p className="auth-mobile-subtitle">Checking your link...</p>
      </AuthMobileLayout>
    );
  }

  if (linkError) {
    return (
      <AuthMobileLayout title="Link not valid">
        <p className="auth-mobile-subtitle">{linkError}</p>
        <Link href="/forgot-password" className="btn btn-primary auth-mobile-submit">
          Request a new link
        </Link>
        <Link href="/login" className="auth-mobile-link">
          Back to sign in
        </Link>
      </AuthMobileLayout>
    );
  }

  if (done) {
    return (
      <AuthMobileLayout title="Password changed">
        <p className="auth-mobile-subtitle">Your password has been changed. Please sign in again with your new password.</p>
        <Link href="/login" className="btn btn-primary auth-mobile-submit">
          Sign in
        </Link>
      </AuthMobileLayout>
    );
  }

  return (
    <AuthMobileLayout title="Create new password" subtitle={`Choose a new password of at least ${MIN_LENGTH} characters.`}>
      <form onSubmit={onSubmit}>
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={MIN_LENGTH}
          maxLength={72}
          required
          autoFocus
        />

        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={MIN_LENGTH}
          maxLength={72}
          required
        />

        <label className="auth-mobile-show">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
        </label>

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary auth-mobile-submit" type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Change password'}
        </button>
      </form>
    </AuthMobileLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
