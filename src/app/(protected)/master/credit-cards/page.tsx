'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface CreditCard {
  id: string;
  bank: string;
  last4: string;
  cardHolderName: string;
  isActive: boolean;
  departmentId: string | null;
  department: { id: string; name: string } | null;
}

interface DepartmentOption {
  id: string;
  name: string;
}

export default function CreditCardsPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('ADMIN');

  const [cards, setCards] = useState<CreditCard[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ bank: '', last4: '', cardHolderName: '', isActive: true, departmentId: '' });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filteredCards = cards.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [c.bank, c.last4, c.cardHolderName, c.department?.name].some((v) => v?.toLowerCase().includes(q));
  });
  const pagination = usePagination(filteredCards);

  const load = () => {
    api.get<CreditCard[]>('/credit-cards').then(setCards).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, []);
  useEffect(() => {
    api.get<DepartmentOption[]>('/departments?active=true').then(setDepartmentOptions).catch(() => undefined);
  }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ bank: '', last4: '', cardHolderName: '', isActive: true, departmentId: '' });
  };

  const startEdit = (c: CreditCard) => {
    setEditingId(c.id);
    setForm({ bank: c.bank, last4: c.last4, cardHolderName: c.cardHolderName, isActive: c.isActive, departmentId: c.departmentId ?? '' });
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, departmentId: form.departmentId || null };
      if (editingId) {
        await api.patch(`/credit-cards/${editingId}`, payload);
      } else {
        await api.post('/credit-cards', payload);
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
        <h1>Corporate Card</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search bank, last 4, card holder, department..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          {canManage && (
            <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : '+ New Corporate Card'}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Corporate Card' : 'New Corporate Card'}</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Bank</label>
              <input required value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Last 4 Digits</label>
              <input required maxLength={4} value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Card Holder Name</label>
              <input required value={form.cardHolderName} onChange={(e) => setForm({ ...form, cardHolderName: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Department (1 Department = 1 card)</label>
              <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">— Unassigned —</option>
                {departmentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Active
              </label>
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
              <th>Bank</th>
              <th>Last 4</th>
              <th>Card Holder</th>
              <th>Department</th>
              <th>Active</th>
              {canManage && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((c) => (
              <tr key={c.id}>
                <td>{c.bank}</td>
                <td>{c.last4}</td>
                <td>{c.cardHolderName}</td>
                <td>{c.department?.name ?? '-'}</td>
                <td>{c.isActive ? 'Yes' : 'No'}</td>
                {canManage && (
                  <td>
                    <button className="btn" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {filteredCards.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} style={{ color: 'var(--muted)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredCards.length > 0 && (
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
