'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import SearchBox from '@/components/SearchBox';
import { useConfirm } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';

type DocType = 'EXPENSE' | 'SETTLEMENT' | 'EXPENSE_REQUEST';

interface Candidate {
  id: string;
  docNo: string;
  status: string;
  amount: string;
  department: string | null;
  requestStatus: string | null;
  currentStep: number;
  totalSteps: number;
}

interface StepRow {
  stepOrder: number;
  positionCode: string;
  positionName: string;
  approverName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface Preview {
  type: DocType;
  id: string;
  docNo: string;
  status: string;
  amount: string;
  department: string | null;
  memberCount: number | null;
  requestStatus: string | null;
  currentStep: number;
  maxSteps: number;
  blocker: string | null;
  steps: StepRow[];
}

const TYPE_LABEL: Record<DocType, string> = { EXPENSE: 'Expense', SETTLEMENT: 'Settlement', EXPENSE_REQUEST: 'Expense Request' };
const DOC_TYPES: DocType[] = ['EXPENSE', 'SETTLEMENT', 'EXPENSE_REQUEST'];

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

function stepBadge(status: StepRow['status']) {
  return status === 'APPROVED' ? 'badge-success' : status === 'REJECTED' ? 'badge-danger' : 'badge-warning';
}

// System > Rollback: an Administrator rewinds an Expense, Settlement or Expense
// Request approval chain by N tiers. The reopened tier's approver gets the document again.
export default function RollbackPage() {
  const confirm = useConfirm();
  const toast = useToast();

  const [type, setType] = useState<DocType>('EXPENSE');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [steps, setSteps] = useState(1);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRows = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get<Candidate[]>(`/approval-rollback/${type}${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [type, search]);

  useEffect(loadRows, [loadRows]);

  const loadPreview = useCallback(
    (id: string) => {
      setPreview(null);
      api
        .get<Preview>(`/approval-rollback/${type}/${id}`)
        .then((p) => {
          setPreview(p);
          setSteps(1);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    },
    [type],
  );

  useEffect(() => {
    if (selectedId) loadPreview(selectedId);
  }, [selectedId, loadPreview]);

  const switchType = (next: DocType) => {
    if (next === type) return;
    setType(next);
    setSelectedId(null);
    setPreview(null);
    setRows([]);
    setSearch('');
    setSearchInput('');
    setReason('');
  };

  const targetStep = preview ? preview.currentStep - steps : 0;
  const targetRow = preview?.steps.find((s) => s.stepOrder === targetStep);

  const submit = async () => {
    if (!preview || preview.blocker) return;
    if (reason.trim().length < 3) {
      setError('Reason is required (min 3 characters)');
      return;
    }
    const ok = await confirm({
      title: `Rollback ${preview.docNo}?`,
      message: `Rewinds ${steps} approval step(s) back to "${targetRow?.positionName ?? `step ${targetStep + 1}`}" (${targetRow?.approverName ?? '-'}). That approver will be asked to approve again.`,
      confirmLabel: 'Rollback',
      danger: true,
    });
    if (!ok) return;

    setSubmitting(true);
    setError('');
    try {
      const updated = await api.post<Preview>(`/approval-rollback/${type}/${preview.id}`, { steps, reason: reason.trim() });
      setPreview(updated);
      setSteps(1);
      setReason('');
      toast.success(`${preview.docNo} rolled back to "${targetRow?.positionName ?? 'earlier step'}"`);
      loadRows();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rollback failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Rollback Approval</h1>
        <SearchBox
          placeholder={`Search ${TYPE_LABEL[type].toLowerCase()} no...`}
          value={searchInput}
          onChange={setSearchInput}
          onSearch={() => setSearch(searchInput.trim())}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {DOC_TYPES.map((t) => (
          <button key={t} type="button" className={`btn ${type === t ? 'btn-primary' : ''}`} onClick={() => switchType(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {error && <div className="error-text">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Dept</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  style={{ cursor: 'pointer', background: r.id === selectedId ? 'var(--surface-2)' : undefined }}
                >
                  <td>{r.docNo}</td>
                  <td>{r.department ?? '-'}</td>
                  <td>{formatCurrency(r.amount)}</td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td>
                    {Math.min(r.currentStep, r.totalSteps)}/{r.totalSteps}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--muted)' }}>
                    {loading ? 'Loading...' : 'No data'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          {!selectedId && <div style={{ color: 'var(--muted)' }}>Pick a {TYPE_LABEL[type].toLowerCase()} on the left.</div>}
          {selectedId && !preview && <div style={{ color: 'var(--muted)' }}>Loading...</div>}
          {preview && (
            <div>
              <h3 style={{ marginTop: 0 }}>{preview.docNo}</h3>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
                {preview.department ?? '-'} · {formatCurrency(preview.amount)}
                {preview.memberCount !== null && ` · ${preview.memberCount} expense(s)`} ·{' '}
                <span className="badge">{preview.status}</span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Position</th>
                    <th>Approver</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.steps.map((s) => {
                    const reopened = !preview.blocker && s.stepOrder >= targetStep;
                    return (
                      <tr key={s.stepOrder} style={{ background: reopened ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : undefined }}>
                        <td>{s.stepOrder + 1}</td>
                        <td>{s.positionName}</td>
                        <td>{s.approverName}</td>
                        <td>
                          <span className={`badge ${stepBadge(s.status)}`}>{s.status}</span>
                          {s.stepOrder === preview.currentStep && <span style={{ marginLeft: 6, fontSize: 11 }}>current</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {preview.blocker ? (
                <div className="error-text" style={{ marginTop: 12 }}>
                  {preview.blocker}
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <div className="form-row">
                    <label>Rollback how many steps</label>
                    <select value={steps} onChange={(e) => setSteps(Number(e.target.value))}>
                      {Array.from({ length: preview.maxSteps }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n} step{n > 1 ? 's' : ''}
                          {' → '}
                          {preview.steps.find((s) => s.stepOrder === preview.currentStep - n)?.positionName ?? ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Reason</label>
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this rolled back?" />
                  </div>
                  <button type="button" className="btn btn-danger" disabled={submitting} onClick={submit} style={{ marginTop: 8 }}>
                    {submitting ? 'Rolling back...' : 'Rollback'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
