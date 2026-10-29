'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmDialog';
import { useAuth } from '@/lib/auth';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface AdvertiserOption {
  id: string;
  name: string;
  agencies?: { agency: { name: string } }[];
}

interface Brand {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  advertiser?: { id: string; name: string; agencies?: { agency: { name: string } }[] };
}

// Every Brand belongs to exactly one Advertiser (Agency -> Advertiser -> Brand,
// never shared) - so creating a Brand requires picking its Advertiser.
export default function BrandsPage() {
  const { hasRole } = useAuth();
  const confirm = useConfirm();
  const canManage = hasRole('ADMINISTRATOR');

  const [brands, setBrands] = useState<Brand[]>([]);
  const [advertisers, setAdvertisers] = useState<AdvertiserOption[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', advertiserId: '', isActive: true });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const pagination = usePagination(brands);

  const load = () => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get<Brand[]>(`/brands${qs}`).then(setBrands).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api.get<AdvertiserOption[]>('/advertisers?active=true').then(setAdvertisers).catch(() => undefined);
  };

  useEffect(load, [search]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ code: '', name: '', advertiserId: '', isActive: true });
  };

  const startEdit = (b: Brand) => {
    setEditingId(b.id);
    setForm({ code: b.code, name: b.name, advertiserId: b.advertiser?.id ?? '', isActive: b.isActive });
    setShowForm(true);
  };

  const onDelete = async (row: { id: string; }, label: string) => {
    const ok = await confirm({
      title: 'Delete Brand?',
      message: `"${label}" will be permanently deleted. This cannot be undone.`,
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      await api.del(`/brands/${row.id}`);
      if (editingId === row.id) closeForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.patch(`/brands/${editingId}`, form);
      } else {
        await api.post('/brands', form);
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
        <h1>Brand</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search code or name..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          {canManage && (
            <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : '+ New Brand'}
            </button>
          )}
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8, fontSize: 12 }}>
        Showing up to 200 results — use search to narrow down (there are 1000+ Brands in the demo dataset).
      </p>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Brand' : 'New Brand'}</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Code</label>
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Advertiser</label>
              <select required value={form.advertiserId} onChange={(e) => setForm({ ...form, advertiserId: e.target.value })}>
                <option value="">Select advertiser</option>
                {advertisers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.agencies?.length ? `(${a.agencies.map((l) => l.agency.name).join(', ')})` : ''}
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
              <th>Advertiser</th>
              <th>Agency</th>
              <th>Active</th>
              {canManage && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((b) => (
              <tr key={b.id}>
                <td>{b.code}</td>
                <td>{b.name}</td>
                <td>{b.advertiser?.name ?? '-'}</td>
                <td>{b.advertiser?.agencies?.map((l) => l.agency.name).join(', ') || '-'}</td>
                <td>{b.isActive ? 'Yes' : 'No'}</td>
                {canManage && (
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" onClick={() => startEdit(b)}>
                        Edit
                      </button>
                      <button className="btn btn-danger" onClick={() => onDelete(b, b.name)}>
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {brands.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} style={{ color: 'var(--muted)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
        {brands.length > 0 && (
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
