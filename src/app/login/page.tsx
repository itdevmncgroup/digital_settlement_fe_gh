'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { NavIcon } from '@/components/NavIcons';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

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

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', marginTop: 20, justifyContent: 'center' }}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
