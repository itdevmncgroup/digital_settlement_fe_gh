'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import NumberInput from '@/components/NumberInput';
import DatePicker from '@/components/DatePicker';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface Option {
  id: string;
  name: string;
}

interface SalesOption extends Option {
  employeeId: string;
  roles: string[];
}

interface ApprovalStep {
  stepOrder: number;
  status: string;
  position: { name: string };
  resolvedApprover: { id: string; name: string };
}

interface ApprovalRequestSummary {
  currentStep: number;
  status: string;
  steps: ApprovalStep[];
}

interface EventRow {
  id: string;
  eventNo: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  purpose: string;
  estimatedAmount: string;
  notes: string | null;
  status: string;
  rejectReason: string | null;
  salesId: string;
  sales: { name: string };
  advertiser: { id: string; name: string };
  brand: { id: string; name: string };
  activityType: { id: string; name: string };
  pod: { id: string; name: string } | null;
  approvalRequest: ApprovalRequestSummary | null;
}

const STATUS_OPTIONS = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'COMPLETED'];

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'APPROVED'
      ? 'badge-success'
      : status === 'REJECTED'
      ? 'badge-danger'
      : status === 'SUBMITTED'
      ? 'badge-warning'
      : 'badge-info';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Pre-Event request (BRD section 7-8). Sales creates + submits; approved via
// the POD/Department-scoped Approval Level chain (see /events/[id] for the trail).
export default function EventsPage() {
  const { hasRole, user } = useAuth();
  const canActOnBehalf = hasRole('ADMIN', 'FINANCE');
  const canCreate = hasRole('SALES') || canActOnBehalf;

  const [rows, setRows] = useState<EventRow[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [advertisers, setAdvertisers] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [activityTypes, setActivityTypes] = useState<Option[]>([]);
  const [salesOptions, setSalesOptions] = useState<SalesOption[]>([]);
  const [onBehalfOfSalesId, setOnBehalfOfSalesId] = useState('');
  const [podOptions, setPodOptions] = useState<Option[]>([]);
  const [form, setForm] = useState({
    advertiserId: '',
    brandId: '',
    activityTypeId: '',
    podId: '',
    date: '',
    startTime: '',
    endTime: '',
    location: '',
    purpose: '',
    estimatedAmount: '',
    notes: '',
  });

  const pagination = usePagination(rows);

  const load = () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const qs = params.toString();
    api
      .get<EventRow[]>(`/events${qs ? `?${qs}` : ''}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, [status, search]);

  useEffect(() => {
    if (!canCreate) return;
    api.get<Option[]>('/advertisers').then(setAdvertisers).catch(() => undefined);
    api.get<Option[]>('/brands').then(setBrands).catch(() => undefined);
    api.get<Option[]>('/activity-types').then(setActivityTypes).catch(() => undefined);
    if (canActOnBehalf) {
      api
        .get<SalesOption[]>('/users')
        .then((users) => setSalesOptions(users.filter((u) => u.roles.includes('SALES'))))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, canActOnBehalf]);

  useEffect(() => {
    const targetSalesId = canActOnBehalf ? onBehalfOfSalesId : user?.id;
    if (!targetSalesId) {
      setPodOptions([]);
      return;
    }
    const path = canActOnBehalf ? `/pods?salesId=${targetSalesId}` : '/pods/me';
    api.get<Option[]>(path).then(setPodOptions).catch(() => undefined);
  }, [canActOnBehalf, onBehalfOfSalesId, user?.id]);

  const resetForm = () => {
    setForm({ advertiserId: '', brandId: '', activityTypeId: '', podId: '', date: '', startTime: '', endTime: '', location: '', purpose: '', estimatedAmount: '', notes: '' });
    setOnBehalfOfSalesId('');
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    resetForm();
  };

  const startEdit = (r: EventRow) => {
    setEditingId(r.id);
    setForm({
      advertiserId: r.advertiser?.id ?? '',
      brandId: r.brand?.id ?? '',
      activityTypeId: r.activityType?.id ?? '',
      podId: r.pod?.id ?? '',
      date: r.date.slice(0, 10),
      startTime: r.startTime ?? '',
      endTime: r.endTime ?? '',
      location: r.location ?? '',
      purpose: r.purpose,
      estimatedAmount: r.estimatedAmount,
      notes: r.notes ?? '',
    });
    // So the POD dropdown reflects the owning Sales' PODs when back-office edits
    // someone else's request (mirrors the create form's on-behalf-of wiring).
    if (canActOnBehalf) setOnBehalfOfSalesId(r.salesId);
    setShowForm(true);
  };

  // Editable while DRAFT or SUBMITTED (i.e. any time before the approval chain finishes).
  const canEditRow = (r: EventRow) => (r.status === 'DRAFT' || r.status === 'SUBMITTED') && (r.salesId === user?.id || canActOnBehalf);

  const isAdmin = hasRole('ADMIN');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Current step of a row's approval chain, if any - the only step ever
  // actionable (approval is strictly sequential). Its resolvedApprover is who
  // can act on it; an Admin can act on anyone's current step (override).
  const currentStepOf = (r: EventRow) => {
    const ar = r.approvalRequest;
    if (!ar || ar.status !== 'PENDING') return null;
    return ar.steps.find((s) => s.stepOrder === ar.currentStep) ?? null;
  };
  const canActOnRow = (r: EventRow) => {
    const step = currentStepOf(r);
    return !!step && (step.resolvedApprover?.id === user?.id || isAdmin);
  };

  const approveRow = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/approvals/event/${id}/approve`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const rejectRow = async (id: string) => {
    const reason = window.prompt('Reject reason:');
    if (!reason) return;
    setBusyId(id);
    setError('');
    try {
      await api.post(`/approvals/event/${id}/reject`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        advertiserId: form.advertiserId,
        brandId: form.brandId,
        activityTypeId: form.activityTypeId,
        podId: form.podId || undefined,
        date: form.date,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        location: form.location || undefined,
        purpose: form.purpose,
        estimatedAmount: Number(form.estimatedAmount),
        notes: form.notes || undefined,
      };
      if (canActOnBehalf && onBehalfOfSalesId) payload.salesId = onBehalfOfSalesId;

      if (editingId) {
        await api.patch(`/events/${editingId}`, payload);
      } else {
        const created = await api.post<{ id: string }>('/events', payload);
        await api.post(`/events/${created.id}/submit`);
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
        <h1>Pre-Event Requests</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search event no, purpose, sales, advertiser, brand..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : '+ New Request'}
            </button>
          )}
        </div>
      </div>

      {hasRole('SALES') && !canActOnBehalf && (
        <p style={{ color: 'var(--muted)', marginTop: -8 }}>
          Request must go through its full approval chain (see the request detail page) before you can create an
          Expense against it.
        </p>
      )}

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Pre-Event Request' : 'New Pre-Event Request'}</h3>
          {canActOnBehalf && (
            <div className="form-row" style={{ maxWidth: 360 }}>
              <label>{editingId ? 'Sales (reassign owner)' : 'Sales (manual entry on behalf of)'}</label>
              <select value={onBehalfOfSalesId} onChange={(e) => setOnBehalfOfSalesId(e.target.value)}>
                <option value="">Select Sales</option>
                {salesOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.employeeId})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-grid">
            <div className="form-row">
              <label>Advertiser</label>
              <select required value={form.advertiserId} onChange={(e) => setForm({ ...form, advertiserId: e.target.value })}>
                <option value="">Select advertiser</option>
                {advertisers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Brand</label>
              <select required value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
                <option value="">Select brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Activity Type</label>
              <select required value={form.activityTypeId} onChange={(e) => setForm({ ...form, activityTypeId: e.target.value })}>
                <option value="">Select activity</option>
                {activityTypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>POD (determines approval chain)</label>
              <select value={form.podId} onChange={(e) => setForm({ ...form, podId: e.target.value })}>
                <option value="">- (auto if you cover exactly one POD)</option>
                {podOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Date</label>
              <DatePicker required value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            </div>
            <div className="form-row">
              <label>Estimated Amount (IDR)</label>
              <NumberInput required value={form.estimatedAmount} onChange={(v) => setForm({ ...form, estimatedAmount: v })} />
            </div>
            <div className="form-row">
              <label>Location (optional)</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Purpose</label>
              <input required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving || !form.date} style={{ marginTop: 16 }}>
            {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Submit Request'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Event No</th>
              <th>Date</th>
              <th>Sales</th>
              <th>Advertiser</th>
              <th>Brand</th>
              <th>Activity</th>
              <th>Est. Amount</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/events/${r.id}`}>{r.eventNo}</Link>
                </td>
                <td>{formatDate(r.date)}</td>
                <td>{r.sales?.name}</td>
                <td>{r.advertiser?.name}</td>
                <td>{r.brand?.name}</td>
                <td>{r.activityType?.name}</td>
                <td>{formatCurrency(r.estimatedAmount)}</td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.rejectReason && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>{r.rejectReason}</div>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {canEditRow(r) && (
                      <button className="btn" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                    )}
                    {canActOnRow(r) && (
                      <>
                        <button className="btn btn-success" disabled={busyId === r.id} onClick={() => approveRow(r.id)}>
                          Approve ({currentStepOf(r)?.position.name})
                        </button>
                        <button className="btn btn-danger" disabled={busyId === r.id} onClick={() => rejectRow(r.id)}>
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--muted)' }}>
                  No requests
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {rows.length > 0 && (
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
