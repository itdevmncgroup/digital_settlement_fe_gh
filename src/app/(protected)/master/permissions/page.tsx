'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface PermissionRow {
  id: string;
  code: string;
  description: string | null;
  isActive: boolean;
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', description: '' });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filteredPermissions = permissions.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.code.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q);
  });
  const pagination = usePagination(filteredPermissions);

  const load = () => {
    api
      .get<PermissionRow[]>('/permissions')
      .then(setPermissions)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ code: '', description: '' });
  };

  const startEdit = (p: PermissionRow) => {
    setEditingId(p.id);
    setForm({ code: p.code, description: p.description ?? '' });
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { code: form.code.trim(), description: form.description || undefined };
      if (editingId) {
        await api.patch(`/permissions/${editingId}`, payload);
      } else {
        await api.post('/permissions', payload);
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: PermissionRow) => {
    setError('');
    try {
      await api.patch(`/permissions/${p.id}`, { isActive: !p.isActive });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Permission</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search code or description..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : '+ New Permission'}
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8, fontSize: 12 }}>
        Attach permissions to roles from the Role page. A route only honors a permission once a developer tags it
        with @RequirePermission(code) - see roles.guard.ts.
      </p>

      {error && <div className="error-text">{error}</div>}

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Permission' : 'New Permission'}</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Code</label>
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. expense.export" />
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

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Active</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((p) => (
              <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.6 }}>
                <td>{p.code}</td>
                <td>{p.description || '-'}</td>
                <td>{p.isActive ? 'Yes' : 'No'}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => startEdit(p)}>
                    Edit
                  </button>
                  <button className={`btn ${p.isActive ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleActive(p)}>
                    {p.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {filteredPermissions.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--muted)' }}>
                  No permissions
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredPermissions.length > 0 && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            total={pagination.total}
            rangeStart={pagination.rangeStart}
            rangeEnd={pagination.rangeEnd}
          />
        )}
      </div>
    </div>
  );
}
