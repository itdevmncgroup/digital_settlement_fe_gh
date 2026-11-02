'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import NumberInput from '@/components/NumberInput';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';
import { useConfirm } from '@/components/ConfirmDialog';

interface Option {
  id: string;
  name: string;
}

// Sort naturally ascending ("POD 2" before "POD 10").
const departmentCollator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
function sortDepartments(departments: Option[]): Option[] {
  return [...departments].sort((a, b) => departmentCollator.compare(a.name, b.name));
}

interface LevelStep {
  stepOrder: number;
  position: Option;
}

interface ApprovalLevel {
  id: string;
  name: string;
  documentStage: 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT' | 'EXPENSE_REQUEST';
  scopeType: 'ANY' | 'DEPARTMENT';
  departments: { departmentId: string; department: Option }[];
  requestorPositions: { positionId: string; position: Option }[];
  activityTypes: { activityTypeId: string; activityType: Option }[];
  paymentMethods: { paymentMethodId: string; paymentMethod: Option }[];
  minAmount: string;
  maxAmount: string | null;
  isActive: boolean;
  steps: LevelStep[];
}

const STAGE_LABEL: Record<ApprovalLevel['documentStage'], string> = {
  PRE_EVENT: 'Pre-Event',
  EXPENSES: 'Expenses',
  SETTLEMENT: 'Settlement',
  EXPENSE_REQUEST: 'Expense Request',
};

const EMPTY_PANEL = {
  stage: '',
  status: '',
  scope: '',
  activityTypeId: '',
  paymentMethodId: '',
  departmentId: '',
  requestorPositionId: '',
  chainPositionId: '',
  amount: '',
};

// Panel select value meaning "Levels with no restriction on this dimension" (an empty list = any).
const ANY = '__ANY__';
// '' = no filter, ANY = a Level that lists nothing, otherwise a Level that lists that id.
const matchesList = (selected: string, ids: string[]) => !selected || (selected === ANY ? ids.length === 0 : ids.includes(selected));

function formatCurrency(value: string | number | null) {
  if (value === null) return 'No limit';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Approval Level (replaces the old Approval Rule): configurable per Document
// Stage (Pre-Event / Settlement) and per Department scope, with an ordered
// Position chain (e.g. Head -> Supervisor). At submit time every step is
// resolved to a concrete user (Department -> that Department's Approvers,
// Any -> any active holder).
export default function ApprovalLevelsPage() {
  const confirm = useConfirm();
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [activityTypes, setActivityTypes] = useState<Option[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<Option[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    documentStage: 'EXPENSES' as 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT' | 'EXPENSE_REQUEST',
    scopeType: 'ANY' as 'ANY' | 'DEPARTMENT',
    departmentIds: [] as string[],
    requestorPositionIds: [] as string[],
    activityTypeIds: [] as string[],
    paymentMethodIds: [] as string[],
    minAmount: '0',
    maxAmount: '',
    isActive: true,
    stepPositionIds: [] as string[],
  });
  const [pickerPositionId, setPickerPositionId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [panel, setPanel] = useState(EMPTY_PANEL);
  const setField = (key: keyof typeof EMPTY_PANEL) => (value: string) => setPanel((prev) => ({ ...prev, [key]: value }));
  const resetFilters = () => {
    setPanel(EMPTY_PANEL);
    setSearch('');
    setSearchInput('');
  };
  const filtersActive = !!search || Object.values(panel).some((v) => v !== '');

  const filteredLevels = levels.filter((l) => {
    if (search) {
      const q = search.toLowerCase();
      const haystack = [
        l.name,
        STAGE_LABEL[l.documentStage],
        ...l.activityTypes.map((a) => a.activityType.name),
        ...l.paymentMethods.map((m) => m.paymentMethod.name),
        ...l.departments.map((d) => d.department.name),
        ...l.requestorPositions.map((p) => p.position.name),
        ...l.steps.map((s) => s.position.name),
      ];
      if (!haystack.some((v) => v?.toLowerCase().includes(q))) return false;
    }
    if (panel.stage && l.documentStage !== panel.stage) return false;
    if (panel.status && l.isActive !== (panel.status === 'active')) return false;
    if (panel.scope && l.scopeType !== panel.scope) return false;
    if (!matchesList(panel.activityTypeId, l.activityTypes.map((a) => a.activityTypeId))) return false;
    if (!matchesList(panel.paymentMethodId, l.paymentMethods.map((m) => m.paymentMethodId))) return false;
    if (!matchesList(panel.departmentId, l.departments.map((d) => d.departmentId))) return false;
    if (!matchesList(panel.requestorPositionId, l.requestorPositions.map((p) => p.positionId))) return false;
    if (panel.chainPositionId && !l.steps.some((s) => s.position.id === panel.chainPositionId)) return false;
    // "Amount" finds the Levels whose range covers that amount.
    if (panel.amount !== '') {
      const amount = Number(panel.amount);
      if (amount < Number(l.minAmount) || (l.maxAmount !== null && amount > Number(l.maxAmount))) return false;
    }
    return true;
  });
  const pagination = usePagination(filteredLevels);

  const load = () => {
    api.get<ApprovalLevel[]>('/approval-levels').then(setLevels).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api.get<Option[]>('/positions?active=true').then(setPositions).catch(() => undefined);
    api.get<Option[]>('/activity-types?active=true').then(setActivityTypes).catch(() => undefined);
    api.get<Option[]>('/payment-methods?active=true').then(setPaymentMethods).catch(() => undefined);
    api.get<Option[]>('/departments?active=true').then((res) => setDepartments(sortDepartments(res))).catch(() => undefined);
  };

  useEffect(load, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({
      name: '',
      documentStage: 'EXPENSES',
      scopeType: 'ANY',
      departmentIds: [],
      requestorPositionIds: [],
      activityTypeIds: [],
      paymentMethodIds: [],
      minAmount: '0',
      maxAmount: '',
      isActive: true,
      stepPositionIds: [],
    });
    setPickerPositionId('');
  };

  const startEdit = (l: ApprovalLevel) => {
    setEditingId(l.id);
    setForm({
      name: l.name,
      documentStage: l.documentStage,
      scopeType: l.scopeType,
      departmentIds: l.departments.map((d) => d.departmentId),
      requestorPositionIds: l.requestorPositions.map((p) => p.positionId),
      activityTypeIds: l.activityTypes.map((a) => a.activityTypeId),
      paymentMethodIds: l.paymentMethods.map((m) => m.paymentMethodId),
      minAmount: l.minAmount,
      maxAmount: l.maxAmount ?? '',
      isActive: l.isActive,
      stepPositionIds: [...l.steps].sort((a, b) => a.stepOrder - b.stepOrder).map((s) => s.position.id),
    });
    setShowForm(true);
  };

  const toggleDepartment = (id: string) => {
    setForm((f) => ({
      ...f,
      departmentIds: f.departmentIds.includes(id) ? f.departmentIds.filter((d) => d !== id) : [...f.departmentIds, id],
    }));
  };

  const toggleActivityType = (id: string) => {
    setForm((f) => ({
      ...f,
      activityTypeIds: f.activityTypeIds.includes(id) ? f.activityTypeIds.filter((a) => a !== id) : [...f.activityTypeIds, id],
    }));
  };

  const togglePaymentMethod = (id: string) => {
    setForm((f) => ({
      ...f,
      paymentMethodIds: f.paymentMethodIds.includes(id) ? f.paymentMethodIds.filter((m) => m !== id) : [...f.paymentMethodIds, id],
    }));
  };

  const toggleRequestorPosition = (id: string) => {
    setForm((f) => ({
      ...f,
      requestorPositionIds: f.requestorPositionIds.includes(id)
        ? f.requestorPositionIds.filter((p) => p !== id)
        : [...f.requestorPositionIds, id],
    }));
  };

  const addStep = () => {
    if (!pickerPositionId) return;
    setForm((f) => ({ ...f, stepPositionIds: [...f.stepPositionIds, pickerPositionId] }));
    setPickerPositionId('');
  };

  const removeStep = (index: number) => {
    setForm((f) => ({ ...f, stepPositionIds: f.stepPositionIds.filter((_, i) => i !== index) }));
  };

  // The API refuses (409) while a running Expense / Expense Request / Settlement still uses the Level, or when only
  // finished history references it (then it can only be deactivated) - the message is shown as-is.
  const onDelete = async (l: ApprovalLevel) => {
    const ok = await confirm({
      title: 'Delete Approval Level?',
      message: `"${l.name}" will be permanently deleted. This cannot be undone.`,
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      await api.del(`/approval-levels/${l.id}`);
      if (editingId === l.id) closeForm();
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
      const steps = form.stepPositionIds.map((positionId) => ({ positionId }));
      if (editingId) {
        await api.patch(`/approval-levels/${editingId}`, {
          name: form.name,
          scopeType: form.scopeType,
          departmentIds: form.scopeType === 'DEPARTMENT' ? form.departmentIds : undefined,
          requestorPositionIds: form.requestorPositionIds,
          activityTypeIds: form.activityTypeIds, // [] clears the filter
          paymentMethodIds: form.paymentMethodIds, // [] clears the restriction
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
          departmentIds: form.scopeType === 'DEPARTMENT' ? form.departmentIds : undefined,
          requestorPositionIds: form.requestorPositionIds,
          activityTypeIds: form.activityTypeIds,
          paymentMethodIds: form.paymentMethodIds,
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
    if (l.scopeType === 'DEPARTMENT') return `Department: ${l.departments.map((d) => d.department.name).join(', ') || '-'}`;
    return 'Any';
  };

  const requestorLabel = (l: ApprovalLevel) =>
    l.requestorPositions.length > 0 ? l.requestorPositions.map((p) => p.position.name).join(', ') : 'Any';

  return (
    <div>
      <div className="toolbar">
        <h1>Approval Level</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search name, stage, department, position..."
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
        On submit, a Pre-Event or Expense is matched against active Levels by Document Stage, amount, scope
        (Department exact match wins over Any), and optionally the requestor&apos;s own Position (e.g. a Sales
        requestor can get a different chain than a Head Pod requestor). Each step in the chain must resolve to a
        real user (Department -&gt; that Department&apos;s Approvers, Any -&gt; any active holder) or the submit is
        blocked with a precise error.
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
                onChange={(e) => setForm({ ...form, documentStage: e.target.value as 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT' | 'EXPENSE_REQUEST' })}
              >
                {/* PRE_EVENT only backs the retired Event/Pre-Event module - not offered for
                    new Approval Levels, but kept as an option here (disabled select, edit-only)
                    so opening an existing legacy Pre-Event level doesn't show a blank value. */}
                {form.documentStage === 'PRE_EVENT' && <option value="PRE_EVENT">Pre-Event (legacy)</option>}
                <option value="EXPENSES">Expenses</option>
                <option value="SETTLEMENT">Settlement</option>
                <option value="EXPENSE_REQUEST">Expense Request</option>
              </select>
            </div>
            <div className="form-row">
              <label>Activity Type (optional — blank = any activity type)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                {activityTypes.map((a) => (
                  <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={form.activityTypeIds.includes(a.id)}
                      onChange={() => toggleActivityType(a.id)}
                    />
                    {a.name}
                  </label>
                ))}
              </div>
              {form.documentStage === 'EXPENSE_REQUEST' && form.activityTypeIds.length > 0 && (
                <small style={{ color: 'var(--muted)' }}>
                  Expenses of these Activity Types in the Level&apos;s Department(s) skip the Expense approval chain
                  (already approved via the Expense Request); the Settlement chain is unchanged.
                </small>
              )}
            </div>
            <div className="form-row">
              <label>Payment Method (optional — blank = any payment method)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                {paymentMethods.map((m) => (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={form.paymentMethodIds.includes(m.id)}
                      onChange={() => togglePaymentMethod(m.id)}
                    />
                    {m.name}
                  </label>
                ))}
              </div>
              {form.documentStage === 'EXPENSES' && form.paymentMethodIds.length > 0 && (
                <small style={{ color: 'var(--muted)' }}>
                  Expenses governed by this Level can only use the checked Payment Method(s).
                </small>
              )}
              {form.documentStage !== 'EXPENSES' && form.paymentMethodIds.length > 0 && (
                <small style={{ color: 'var(--muted)' }}>Only applied to Expenses stage Levels.</small>
              )}
            </div>
            <div className="form-row">
              <label>Scope</label>
              <select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value as 'ANY' | 'DEPARTMENT' })}>
                <option value="ANY">Any (fallback)</option>
                <option value="DEPARTMENT">Specific Department</option>
              </select>
            </div>
            {form.scopeType === 'DEPARTMENT' && (
              <div className="form-row">
                <label>Departments (this Level's chain covers every one checked)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                  {departments.map((d) => (
                    <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={form.departmentIds.includes(d.id)}
                        onChange={() => toggleDepartment(d.id)}
                      />
                      {d.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="form-row">
              <label>Requestor Position (optional — blank = matches any requestor)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                {positions.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={form.requestorPositionIds.includes(p.id)}
                      onChange={() => toggleRequestorPosition(p.id)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
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

          <button
            className="btn btn-primary"
            type="submit"
            disabled={saving || form.stepPositionIds.length === 0 || (form.scopeType === 'DEPARTMENT' && form.departmentIds.length === 0)}
            style={{ marginTop: 16 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="toolbar">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={panel.stage} onChange={(e) => setField('stage')(e.target.value)} style={{ width: 170 }}>
            <option value="">All Stages</option>
            <option value="EXPENSES">Expenses</option>
            <option value="SETTLEMENT">Settlement</option>
            <option value="EXPENSE_REQUEST">Expense Request</option>
            <option value="PRE_EVENT">Pre-Event (legacy)</option>
          </select>
          <select value={panel.activityTypeId} onChange={(e) => setField('activityTypeId')(e.target.value)} style={{ width: 190 }}>
            <option value="">All Activity Types</option>
            <option value={ANY}>Any (unrestricted)</option>
            {activityTypes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select value={panel.paymentMethodId} onChange={(e) => setField('paymentMethodId')(e.target.value)} style={{ width: 190 }}>
            <option value="">All Payment Methods</option>
            <option value={ANY}>Any (unrestricted)</option>
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select value={panel.scope} onChange={(e) => setField('scope')(e.target.value)} style={{ width: 150 }}>
            <option value="">All Scopes</option>
            <option value="ANY">Any (fallback)</option>
            <option value="DEPARTMENT">Department</option>
          </select>
          <select value={panel.departmentId} onChange={(e) => setField('departmentId')(e.target.value)} style={{ width: 180 }}>
            <option value="">All Departments</option>
            <option value={ANY}>Any (no Department)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={panel.requestorPositionId} onChange={(e) => setField('requestorPositionId')(e.target.value)} style={{ width: 190 }}>
            <option value="">All Requestors</option>
            <option value={ANY}>Any (unrestricted)</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={panel.chainPositionId} onChange={(e) => setField('chainPositionId')(e.target.value)} style={{ width: 190 }}>
            <option value="">Any Position in Chain</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={panel.status} onChange={(e) => setField('status')(e.target.value)} style={{ width: 130 }}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <NumberInput placeholder="Amount covered..." value={panel.amount} onChange={setField('amount')} style={{ width: 150 }} />
          <button type="button" className="btn" disabled={!filtersActive} onClick={resetFilters}>
            Reset
          </button>
          {filtersActive && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {filteredLevels.length} of {levels.length} Levels
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Stage</th>
              <th>Activity Type</th>
              <th>Payment Method</th>
              <th>Scope</th>
              <th>Requestor</th>
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
                <td>{l.documentStage === 'PRE_EVENT' ? 'Pre-Event' : l.documentStage === 'EXPENSES' ? 'Expenses' : l.documentStage === 'EXPENSE_REQUEST' ? 'Expense Request' : 'Settlement'}</td>
                <td>{l.activityTypes.length > 0 ? l.activityTypes.map((a) => a.activityType.name).join(', ') : 'Any'}</td>
                <td>{l.paymentMethods.length > 0 ? l.paymentMethods.map((m) => m.paymentMethod.name).join(', ') : 'Any'}</td>
                <td>{scopeLabel(l)}</td>
                <td>{requestorLabel(l)}</td>
                <td>
                  {formatCurrency(l.minAmount)} – {formatCurrency(l.maxAmount)}
                </td>
                <td>{[...l.steps].sort((a, b) => a.stepOrder - b.stepOrder).map((s) => s.position.name).join(' → ')}</td>
                <td>{l.isActive ? 'Yes' : 'No'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => startEdit(l)}>
                      Edit
                    </button>
                    <button className="btn btn-danger" onClick={() => onDelete(l)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredLevels.length === 0 && (
              <tr>
                <td colSpan={10} style={{ color: 'var(--muted)' }}>
                  {levels.length > 0 ? 'No Approval Levels match the search' : 'No Approval Levels configured — submits will be blocked until one exists'}
                </td>
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
