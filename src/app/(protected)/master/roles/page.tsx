'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface Permission {
  id: string;
  code: string;
  description: string | null;
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  permissions: { permission: Permission }[];
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState('');
  const [savingRoleId, setSavingRoleId] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  const load = () => {
    api.get<RoleRow[]>('/roles').then(setRoles).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, []);
  useEffect(() => {
    api.get<Permission[]>('/permissions').then(setPermissions).catch(() => undefined);
  }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ name: '', description: '' });
  };

  const startEdit = (role: RoleRow) => {
    setEditingId(role.id);
    setForm({ name: role.name, description: role.description ?? '' });
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { name: form.name.trim().toUpperCase().replace(/\s+/g, '_'), description: form.description || undefined };
      if (editingId) {
        await api.patch(`/roles/${editingId}`, payload);
      } else {
        await api.post('/roles', payload);
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (role: RoleRow) => {
    setSavingRoleId(role.id);
    setError('');
    try {
      await api.patch(`/roles/${role.id}`, { isActive: !role.isActive });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSavingRoleId('');
    }
  };

  const togglePermission = async (role: RoleRow, permissionCode: string, checked: boolean) => {
    const currentCodes = role.permissions.map((rp) => rp.permission.code);
    const nextCodes = checked ? [...new Set([...currentCodes, permissionCode])] : currentCodes.filter((c) => c !== permissionCode);

    setSavingRoleId(role.id);
    setError('');
    try {
      await api.post(`/roles/${role.id}/permissions`, { permissionCodes: nextCodes });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSavingRoleId('');
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Role</h1>
        <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
          {showForm ? 'Cancel' : '+ New Role'}
        </button>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8, fontSize: 12 }}>
        SALES/SUPERVISOR/FINANCE/ADMIN/MANAGEMENT are the app&apos;s built-in roles - screens and actions are protected based on
        them. A custom role created here can be assigned to users but won&apos;t unlock anything extra on its own; it needs a
        developer to wire a check for it somewhere.
      </p>

      {error && <div className="error-text">{error}</div>}

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Role' : 'New Role'}</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. AUDITOR"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Description (optional)</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {roles.map((role) => (
        <div key={role.id} className="card" style={{ opacity: role.isActive ? 1 : 0.6 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>
              {role.name}
              {!role.isActive && <span className="badge badge-danger" style={{ marginLeft: 8 }}>Inactive</span>}
              {role.description && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 13 }}> — {role.description}</span>}
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => startEdit(role)}>
                Edit
              </button>
              <button
                className={`btn ${role.isActive ? 'btn-danger' : 'btn-success'}`}
                disabled={savingRoleId === role.id}
                onClick={() => toggleActive(role)}
              >
                {role.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '6px 16px',
              opacity: savingRoleId === role.id ? 0.6 : 1,
              pointerEvents: savingRoleId === role.id ? 'none' : 'auto',
            }}
          >
            {permissions.map((p) => {
              const checked = role.permissions.some((rp) => rp.permission.id === p.id);
              return (
                <label key={p.id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }} title={p.description ?? undefined}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={checked}
                    onChange={(e) => togglePermission(role, p.code, e.target.checked)}
                  />
                  {p.code}
                </label>
              );
            })}
            {permissions.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>No permissions defined</span>}
          </div>
        </div>
      ))}
      {roles.length === 0 && (
        <div className="card" style={{ color: 'var(--muted)' }}>
          No roles
        </div>
      )}
    </div>
  );
}
