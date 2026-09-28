'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function MobileProfilePage() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword.length < 8) return setError('New password must be at least 8 characters');
    if (newPassword !== confirm) return setError('Confirmation does not match new password');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setSuccess('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setShowChangePassword(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Profile</h1>
      <div className="m-hero" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="m-avatar" style={{ background: 'rgba(255,255,255,0.22)', boxShadow: 'none' }}>
          {user?.name?.charAt(0).toUpperCase()}
        </div>
        <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{user?.name}</div>
          <div style={{ fontSize: 12, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            {user?.employeeId}
            {user?.position ? ` · ${user.position.name}` : ''}
          </div>
        </div>
      </div>

      {!showChangePassword && (
        <button
          className="btn"
          type="button"
          onClick={() => {
            setShowChangePassword(true);
            setError('');
            setSuccess('');
          }}
          style={{ width: '100%' }}
        >
          Change password
        </button>
      )}

      {showChangePassword && (
        <form className="card" onSubmit={submit}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Change password</h3>
          <label htmlFor="cur">Current password</label>
          <input id="cur" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <label htmlFor="new">New password</label>
          <input id="new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
          <label htmlFor="conf">Confirm new password</label>
          <input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}
          {success && <div style={{ color: 'var(--success)', marginTop: 10 }}>{success}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setShowChangePassword(false);
                setError('');
                setCurrentPassword('');
                setNewPassword('');
                setConfirm('');
              }}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ flex: 1 }}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <button className="btn btn-danger" onClick={logout} style={{ width: '100%' }}>
        Logout
      </button>
    </div>
  );
}
