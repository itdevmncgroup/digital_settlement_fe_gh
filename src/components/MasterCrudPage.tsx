'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePagination } from '@/lib/usePagination';
import Pagination from './Pagination';
import SearchBox from './SearchBox';

export interface FieldConfig {
  key: string;
  label: string;
  type: 'text' | 'checkbox';
  required?: boolean;
}

interface Props {
  title: string;
  apiPath: string;
  fields: FieldConfig[];
  columns: { key: string; label: string }[];
}

type Row = Record<string, any>;

export default function MasterCrudPage({ title, apiPath, fields, columns }: Props) {
  const { hasRole } = useAuth();
  const canManage = hasRole('ADMIN');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const pagination = usePagination(rows);

  const load = () => {
    setLoading(true);
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    api
      .get<Row[]>(`${apiPath}${qs}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [apiPath, search]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({});
  };

  const startCreate = () => {
    setEditingId(null);
    setForm({});
    setShowForm(true);
  };

  const startEdit = (row: Row) => {
    setEditingId(row.id);
    setForm(Object.fromEntries(fields.map((f) => [f.key, row[f.key]])));
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.patch(`${apiPath}/${editingId}`, form);
      } else {
        await api.post(apiPath, form);
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>{title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder={`Search ${title.toLowerCase()}...`}
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          {canManage && (
            <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : startCreate())}>
              {showForm ? 'Cancel' : `+ New ${title}`}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? `Edit ${title}` : `New ${title}`}</h3>
          <div className="form-grid">
            {fields.map((f) => (
              <div key={f.key} className="form-row">
                <label htmlFor={f.key}>{f.label}</label>
                {f.type === 'checkbox' ? (
                  <input
                    id={f.key}
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={!!form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })}
                  />
                ) : (
                  <input
                    id={f.key}
                    type="text"
                    required={f.required}
                    value={form[f.key] || ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        {loading ? (
          <div>Loading...</div>
        ) : (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {canManage && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {pagination.pageRows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td key={c.key}>{String(row[c.key] ?? '')}</td>
                  ))}
                  {canManage && (
                    <td>
                      <button className="btn" onClick={() => startEdit(row)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (canManage ? 1 : 0)} style={{ color: 'var(--muted)' }}>
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {!loading && rows.length > 0 && (
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
