'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface AgencyOption {
  id: string;
  name: string;
}

interface Advertiser {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  agency?: { id: string; name: string };
}

// Advertiser sits between Agency and Brand (Agency -> Advertiser -> Brand) -
// every Advertiser belongs to exactly one Agency. Brands are managed from the
// Brand page (each Brand picks its owning Advertiser there), not here.
export default function AdvertisersPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('ADMIN');

  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', agencyId: '' });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const pagination = usePagination(advertisers);

  const load = () => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    api
      .get<Advertiser[]>(`/advertisers${qs}`)
      .then(setAdvertisers)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api.get<AgencyOption[]>('/agencies?active=true').then(setAgencies).catch(() => undefined);
  };

  useEffect(load, [search]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ code: '', name: '', agencyId: '' });
  };

  const startEdit = (a: Advertiser) => {
    setEditingId(a.id);
    setForm({ code: a.code, name: a.name, agencyId: a.agency?.id ?? '' });
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.patch(`/advertisers/${editingId}`, form);
      } else {
        await api.post('/advertisers', form);
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
        <h1>Advertiser</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search code or name..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          {canManage && (
            <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : '+ New Advertiser'}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Advertiser' : 'New Advertiser'}</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Code</label>
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Agency</label>
              <select required value={form.agencyId} onChange={(e) => setForm({ ...form, agencyId: e.target.value })}>
                <option value="">Select agency</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Agency</th>
              <th>Active</th>
              {canManage && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((a) => (
              <tr key={a.id}>
                <td>{a.code}</td>
                <td>{a.name}</td>
                <td>{a.agency?.name ?? '-'}</td>
                <td>{a.isActive ? 'Yes' : 'No'}</td>
                {canManage && (
                  <td>
                    <button className="btn" onClick={() => startEdit(a)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {advertisers.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} style={{ color: 'var(--muted)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
        {advertisers.length > 0 && (
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
