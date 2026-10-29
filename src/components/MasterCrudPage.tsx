'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useConfirm } from './ConfirmDialog';
import { usePagination } from '@/lib/usePagination';
import Pagination from './Pagination';
import SearchBox from './SearchBox';
import FileThumb from './FileThumb';
import LocalFileThumb from './LocalFileThumb';

export interface FieldConfig {
  key: string;
  label: string;
  // 'image': picked as a file and uploaded to POST {apiPath}/{id}/{key} after the row is saved;
  // shown from GET {apiPath}/{id}/{key} while the row's has<Key> flag (e.g. hasLogo) is true.
  type: 'text' | 'checkbox' | 'image';
  required?: boolean;
}

interface Props {
  title: string;
  apiPath: string;
  fields: FieldConfig[];
  columns: { key: string; label: string; type?: 'image' }[];
}

type Row = Record<string, any>;

export default function MasterCrudPage({ title, apiPath, fields, columns }: Props) {
  const { hasRole } = useAuth();
  const confirm = useConfirm();
  const canManage = hasRole('ADMINISTRATOR');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Row>({});
  const [imageFiles, setImageFiles] = useState<Record<string, File>>({});
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
    setImageFiles({});
  };

  const startCreate = () => {
    setEditingId(null);
    // A new row starts Active (the backend default); the checkbox lets the admin create it inactive.
    setForm(Object.fromEntries(fields.filter((f) => f.type === 'checkbox' && f.key === 'isActive').map((f) => [f.key, true])));
    setImageFiles({});
    setShowForm(true);
  };

  const startEdit = (row: Row) => {
    setEditingId(row.id);
    setForm(Object.fromEntries(fields.filter((f) => f.type !== 'image').map((f) => [f.key, row[f.key]])));
    setImageFiles({});
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = editingId ? await api.patch<Row>(`${apiPath}/${editingId}`, form) : await api.post<Row>(apiPath, form);
      for (const [key, file] of Object.entries(imageFiles)) {
        await uploadFile(`${apiPath}/${saved.id}/${key}`, file);
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row: Row) => {
    const label = String(row[columns[0].key] ?? '');
    const ok = await confirm({
      title: `Delete ${title}?`,
      message: `${label ? `"${label}" will` : 'This will'} be permanently deleted. This cannot be undone.`,
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      await api.del(`${apiPath}/${row.id}`);
      if (editingId === row.id) closeForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
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
                ) : f.type === 'image' ? (
                  <div>
                    <input
                      id={f.key}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setImageFiles((prev) => ({ ...prev, [f.key]: file }));
                        e.target.value = '';
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {imageFiles[f.key] ? (
                        <LocalFileThumb
                          file={imageFiles[f.key]}
                          onRemove={() => setImageFiles((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== f.key)))}
                        />
                      ) : (
                        editingId &&
                        rows.find((r) => r.id === editingId)?.[`has${f.key.charAt(0).toUpperCase()}${f.key.slice(1)}`] && (
                          <FileThumb path={`${apiPath}/${editingId}/${f.key}`} fileName={f.key} isImage />
                        )
                      )}
                    </div>
                  </div>
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
                    <td key={c.key}>
                      {c.type === 'image' ? (
                        row[`has${c.key.charAt(0).toUpperCase()}${c.key.slice(1)}`] ? (
                          <FileThumb path={`${apiPath}/${row.id}/${c.key}`} fileName={c.key} isImage />
                        ) : (
                          '-'
                        )
                      ) : (
                        String(row[c.key] ?? '')
                      )}
                    </td>
                  ))}
                  {canManage && (
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn" onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        <button className="btn btn-danger" onClick={() => onDelete(row)}>
                          Delete
                        </button>
                      </div>
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
