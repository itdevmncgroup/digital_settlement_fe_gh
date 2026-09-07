'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

interface RoleOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface UserRow {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  status: string;
  roles: string[];
  unit?: { id: string; name: string } | null;
  position?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
}

interface Unit {
  id: string;
  name: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [positions, setPositions] = useState<Unit[]>([]);
  const [departments, setDepartments] = useState<Unit[]>([]);
  const [allRoles, setAllRoles] = useState<RoleOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filteredUsers = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [u.employeeId, u.name, u.email, u.unit?.name, u.position?.name, u.department?.name, ...u.roles].some((v) =>
      v?.toLowerCase().includes(q),
    );
  });
  const pagination = usePagination(filteredUsers);

  const [form, setForm] = useState({
    employeeId: '',
    name: '',
    email: '',
    password: '',
    unitId: '',
    positionId: '',
    departmentId: '',
    status: 'ACTIVE',
    roles: [] as string[],
  });

  const load = () => {
    api.get<UserRow[]>('/users').then(setUsers).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api.get<Unit[]>('/units').then(setUnits).catch(() => undefined);
    api.get<Unit[]>('/positions').then(setPositions).catch(() => undefined);
    api.get<Unit[]>('/departments').then(setDepartments).catch(() => undefined);
    api.get<RoleOption[]>('/roles').then(setAllRoles).catch(() => undefined);
  };

  useEffect(load, []);

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ employeeId: '', name: '', email: '', password: '', unitId: '', positionId: '', departmentId: '', status: 'ACTIVE', roles: [] });
  };

  const startEdit = (u: UserRow) => {
    setEditingId(u.id);
    setForm({
      employeeId: u.employeeId,
      name: u.name,
      email: u.email,
      password: '',
      unitId: u.unit?.id ?? '',
      positionId: u.position?.id ?? '',
      departmentId: u.department?.id ?? '',
      status: u.status,
      roles: u.roles,
    });
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.patch(`/users/${editingId}`, {
          name: form.name,
          unitId: form.unitId || undefined,
          positionId: form.positionId || undefined,
          departmentId: form.departmentId || undefined,
          status: form.status,
        });
        await api.patch(`/users/${editingId}/roles`, { roles: form.roles });
      } else {
        // CreateUserDto has no `status` field (new users are always ACTIVE) - the
        // backend's ValidationPipe rejects unknown properties, so it must be stripped.
        const { status: _status, ...createPayload } = form;
        await api.post('/users', { ...createPayload, positionId: form.positionId || undefined, departmentId: form.departmentId || undefined });
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
        <h1>Users</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search employee ID, name, email, unit, role..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : '+ New User'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit User' : 'New User'}</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Employee ID</label>
              <input required disabled={!!editingId} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Email</label>
              <input required disabled={!!editingId} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            {!editingId && (
              <div className="form-row">
                <label>Password</label>
                <input required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            )}
            <div className="form-row">
              <label>Unit</label>
              <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                <option value="">-</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Position</label>
              <select value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
                <option value="">-</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Department</label>
              <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">-</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            {editingId && (
              <div className="form-row">
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <label>Roles</label>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {allRoles
              .filter((r) => r.isActive || form.roles.includes(r.name))
              .map((r) => (
                <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={form.roles.includes(r.name)} onChange={() => toggleRole(r.name)} />
                  {r.name}
                </label>
              ))}
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
              <th>Employee ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Unit</th>
              <th>Position</th>
              <th>Department</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((u) => (
              <tr key={u.id}>
                <td>{u.employeeId}</td>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.unit?.name || '-'}</td>
                <td>{u.position?.name || '-'}</td>
                <td>{u.department?.name || '-'}</td>
                <td>{u.roles.join(', ')}</td>
                <td>{u.status}</td>
                <td>
                  <button className="btn" onClick={() => startEdit(u)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--muted)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredUsers.length > 0 && (
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
