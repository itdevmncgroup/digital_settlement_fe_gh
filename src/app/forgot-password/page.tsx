'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import AuthMobileLayout from '@/components/AuthMobileLayout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset link. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthMobileLayout title="Check your email">
        <p className="auth-mobile-subtitle">
          If <strong>{email.trim()}</strong> is registered, we have sent a link to reset your password. The link works once and expires shortly.
        </p>
        <Link href="/login" className="btn btn-primary auth-mobile-submit">
          Back to sign in
        </Link>
      </AuthMobileLayout>
    );
  }

  return (
    <AuthMobileLayout title="Forgot password" subtitle="Enter the email you sign in with and we will send you a link to choose a new password.">
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary auth-mobile-submit" type="submit" disabled={submitting}>
          {submitting ? 'Sending...' : 'Send reset link'}
        </button>
        <Link href="/login" className="auth-mobile-link">
          Back to sign in
        </Link>
      </form>
    </AuthMobileLayout>
  );
}
