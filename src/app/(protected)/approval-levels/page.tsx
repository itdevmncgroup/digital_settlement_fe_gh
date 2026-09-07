'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import NumberInput from '@/components/NumberInput';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface Option {
  id: string;
  name: string;
}

// Sort naturally ascending ("POD 2" before "POD 10").
const podCollator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
function sortPods(pods: Option[]): Option[] {
  return [...pods].sort((a, b) => podCollator.compare(a.name, b.name));
}

interface LevelStep {
  stepOrder: number;
  position: Option;
}

interface ApprovalLevel {
  id: string;
  name: string;
  documentStage: 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT';
  scopeType: 'ANY' | 'POD' | 'DEPARTMENT';
  pod: Option | null;
  department: Option | null;
  minAmount: string;
  maxAmount: string | null;
  isActive: boolean;
  steps: LevelStep[];
}

function formatCurrency(value: string | number | null) {
  if (value === null) return 'No limit';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Approval Level (replaces the old Approval Rule): configurable per Document
// Stage (Pre-Event / Settlement) and per POD or Department scope, with an
// ordered Position chain (e.g. Head POD -> Supervisor). At submit time every
// step is resolved to a concrete user (POD -> POD's Approvers, Department ->
// a user holding that Position in that Department, Any -> any active holder).
export default function ApprovalLevelsPage() {
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [pods, setPods] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    documentStage: 'EXPENSES' as 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT',
    scopeType: 'ANY' as 'ANY' | 'POD' | 'DEPARTMENT',
    podId: '',
    departmentId: '',
    minAmount: '0',
    maxAmount: '',
    isActive: true,
    stepPositionIds: [] as string[],
  });
  const [pickerPositionId, setPickerPositionId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filteredLevels = levels.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [l.name, l.pod?.name, l.department?.name].some((v) => v?.toLowerCase().includes(q));
  });
  const pagination = usePagination(filteredLevels);

  const load = () => {
    api.get<ApprovalLevel[]>('/approval-levels').then(setLevels).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api.get<Option[]>('/positions').then(setPositions).catch(() => undefined);
    api.get<Option[]>('/pods').then((res) => setPods(sortPods(res))).catch(() => undefined);
    api.get<Option[]>('/departments').then(setDepartments).catch(() => undefined);
  };

  useEffect(load, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ name: '', documentStage: 'EXPENSES', scopeType: 'ANY', podId: '', departmentId: '', minAmount: '0', maxAmount: '', isActive: true, stepPositionIds: [] });
    setPickerPositionId('');
  };

  const startEdit = (l: ApprovalLevel) => {
    setEditingId(l.id);
    setForm({
      name: l.name,
      documentStage: l.documentStage,
      scopeType: l.scopeType,
      podId: l.pod?.id ?? '',
      departmentId: l.department?.id ?? '',
      minAmount: l.minAmount,
      maxAmount: l.maxAmount ?? '',
      isActive: l.isActive,
      stepPositionIds: [...l.steps].sort((a, b) => a.stepOrder - b.stepOrder).map((s) => s.position.id),
    });
    setShowForm(true);
  };

  const addStep = () => {
    if (!pickerPositionId) return;
    setForm((f) => ({ ...f, stepPositionIds: [...f.stepPositionIds, pickerPositionId] }));
    setPickerPositionId('');
  };

  const removeStep = (index: number) => {
    setForm((f) => ({ ...f, stepPositionIds: f.stepPositionIds.filter((_, i) => i !== index) }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const steps = form.stepPositionIds.map((positionId) => ({ positionId }));
      if (editingId) {
        await api.patch(`/approval-levels/${editingId}`, {
          name: form.name,
          scopeType: form.scopeType,
          podId: form.scopeType === 'POD' ? form.podId : undefined,
          departmentId: form.scopeType === 'DEPARTMENT' ? form.departmentId : undefined,
          minAmount: Number(form.minAmount),
          maxAmount: form.maxAmount ? Number(form.maxAmount) : undefined,
          isActive: form.isActive,
          steps,
        });
      } else {
        await api.post('/approval-levels', {
          name: form.name,
          documentStage: form.documentStage,
          scopeType: form.scopeType,
          podId: form.scopeType === 'POD' ? form.podId : undefined,
          departmentId: form.scopeType === 'DEPARTMENT' ? form.departmentId : undefined,
          minAmount: Number(form.minAmount),
          maxAmount: form.maxAmount ? Number(form.maxAmount) : undefined,
          steps,
        });
      }
      closeForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const scopeLabel = (l: ApprovalLevel) => {
    if (l.scopeType === 'POD') return `POD: ${l.pod?.name ?? '-'}`;
    if (l.scopeType === 'DEPARTMENT') return `Department: ${l.department?.name ?? '-'}`;
    return 'Any';
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Approval Level</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search name, POD, department..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : '+ New Approval Level'}
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        On submit, a Pre-Event or Expense is matched against active Levels by Document Stage, amount, and scope (POD /
        Department exact match wins over Any). Each step in the chain must resolve to a real user (POD -&gt; POD
        Approvers, Department -&gt; a user holding that Position in that Department, Any -&gt; any active holder) or the
        submit is blocked with a precise error.
      </p>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Approval Level' : 'New Approval Level'}</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Document Stage{editingId ? ' — not editable' : ''}</label>
              <select
                disabled={!!editingId}
                value={form.documentStage}
                onChange={(e) => setForm({ ...form, documentStage: e.target.value as 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT' })}
              >
                {/* PRE_EVENT only backs the retired Event/Pre-Event module - not offered for
                    new Approval Levels, but kept as an option here (disabled select, edit-only)
                    so opening an existing legacy Pre-Event level doesn't show a blank value. */}
                {form.documentStage === 'PRE_EVENT' && <option value="PRE_EVENT">Pre-Event (legacy)</option>}
                <option value="EXPENSES">Expenses</option>
                <option value="SETTLEMENT">Settlement</option>
              </select>
            </div>
            <div className="form-row">
              <label>Scope</label>
              <select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value as 'ANY' | 'POD' | 'DEPARTMENT' })}>
                <option value="ANY">Any (fallback)</option>
                <option value="POD">Specific POD</option>
                <option value="DEPARTMENT">Specific Department</option>
              </select>
            </div>
            {form.scopeType === 'POD' && (
              <div className="form-row">
                <label>POD</label>
                <select required value={form.podId} onChange={(e) => setForm({ ...form, podId: e.target.value })}>
                  <option value="">Select POD</option>
                  {pods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.scopeType === 'DEPARTMENT' && (
              <div className="form-row">
                <label>Department</label>
                <select required value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">Select Department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-row">
              <label>Min Amount (IDR)</label>
              <NumberInput required value={form.minAmount} onChange={(v) => setForm({ ...form, minAmount: v })} />
            </div>
            <div className="form-row">
              <label>Max Amount (optional — blank = unbounded)</label>
              <NumberInput value={form.maxAmount} onChange={(v) => setForm({ ...form, maxAmount: v })} />
            </div>
            {editingId && (
              <div className="form-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                  Active
                </label>
              </div>
            )}
          </div>

          <label>Approval chain, in order</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <select value={pickerPositionId} onChange={(e) => setPickerPositionId(e.target.value)} style={{ maxWidth: 260 }}>
              <option value="">Select Position to add...</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!pickerPositionId} onClick={addStep}>
              + Add Step
            </button>
          </div>
          {form.stepPositionIds.length > 0 && (
            <ol style={{ paddingLeft: 20 }}>
              {form.stepPositionIds.map((id, i) => (
                <li key={`${id}-${i}`} style={{ marginBottom: 4 }}>
                  {positions.find((p) => p.id === id)?.name ?? id}{' '}
                  <button type="button" className="btn btn-danger" style={{ padding: '2px 8px', marginLeft: 8 }} onClick={() => removeStep(i)}>
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}

          <button className="btn btn-primary" type="submit" disabled={saving || form.stepPositionIds.length === 0} style={{ marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Stage</th>
              <th>Scope</th>
              <th>Amount Range</th>
              <th>Chain</th>
              <th>Active</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.documentStage === 'PRE_EVENT' ? 'Pre-Event' : l.documentStage === 'EXPENSES' ? 'Expenses' : 'Settlement'}</td>
                <td>{scopeLabel(l)}</td>
                <td>
                  {formatCurrency(l.minAmount)} – {formatCurrency(l.maxAmount)}
                </td>
                <td>{[...l.steps].sort((a, b) => a.stepOrder - b.stepOrder).map((s) => s.position.name).join(' → ')}</td>
                <td>{l.isActive ? 'Yes' : 'No'}</td>
                <td>
                  <button className="btn" onClick={() => startEdit(l)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {filteredLevels.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--muted)' }}>No Approval Levels configured — submits will be blocked until one exists</td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredLevels.length > 0 && (
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
