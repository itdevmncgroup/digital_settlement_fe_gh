'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import SearchBox from '@/components/SearchBox';

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

interface Stage {
  label: string;
  positionCode: string;
  positionName: string;
  people: { name: string; email: string }[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  isCurrent: boolean;
}

interface Trail {
  type: DocType;
  id: string;
  docNo: string;
  status: string;
  amount: string;
  department: string | null;
  requestStatus: string | null;
  stages: Stage[];
  next: Stage | null;
}

const TYPE_LABEL: Record<DocType, string> = { EXPENSE: 'Expense', SETTLEMENT: 'Settlement', EXPENSE_REQUEST: 'Expense Request' };
const DOC_TYPES: DocType[] = ['EXPENSE', 'SETTLEMENT', 'EXPENSE_REQUEST'];

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

function stageBadge(status: Stage['status']) {
  return status === 'APPROVED' ? 'badge-success' : status === 'REJECTED' ? 'badge-danger' : 'badge-warning';
}

// System > Approval Trail: an Administrator sees, per Expense / Settlement / Expense Request, who has to
// approve it (position + e-mail), in order, and who is next.
export default function ApprovalTrailPage() {
  const [type, setType] = useState<DocType>('EXPENSE');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<Trail | null>(null);

  const loadRows = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get<Candidate[]>(`/approval-trail/${type}${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [type, search]);

  useEffect(loadRows, [loadRows]);

  useEffect(() => {
    if (!selectedId) return;
    setTrail(null);
    api
      .get<Trail>(`/approval-trail/${type}/${selectedId}`)
      .then(setTrail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [selectedId, type]);

  const switchType = (next: DocType) => {
    if (next === type) return;
    setType(next);
    setSelectedId(null);
    setTrail(null);
    setRows([]);
    setSearch('');
    setSearchInput('');
  };

  const finished = trail && !trail.next;

  return (
    <div>
      <div className="toolbar">
        <h1>Approval Trail</h1>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 16, alignItems: 'start' }}>
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
          {selectedId && !trail && <div style={{ color: 'var(--muted)' }}>Loading...</div>}
          {trail && (
            <div>
              <h3 style={{ marginTop: 0 }}>{trail.docNo}</h3>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
                {trail.department ?? '-'} · {formatCurrency(trail.amount)} · <span className="badge">{trail.status}</span>
              </div>

              <div
                style={{
                  padding: '10px 12px',
                  marginBottom: 12,
                  borderRadius: 8,
                  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
                  fontSize: 14,
                }}
              >
                {trail.next ? (
                  <>
                    <strong>Next to approve:</strong> {trail.next.positionName}
                    {trail.next.label !== 'Approval' && ` (${trail.next.label})`}
                    <div style={{ marginTop: 4 }}>
                      {trail.next.people.length === 0
                        ? 'No active user holds this Position'
                        : trail.next.people.map((p) => `${p.name} <${p.email}>`).join(', ')}
                    </div>
                  </>
                ) : (
                  <strong>
                    {trail.requestStatus === 'REJECTED' ? 'Rejected - no further approval' : finished && trail.stages.length > 0 ? 'Approval complete - nobody left to approve' : 'No approval chain yet'}
                  </strong>
                )}
              </div>

              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Position</th>
                    <th>Approver</th>
                    <th>Email</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trail.stages.map((s, i) => (
                    <tr key={`${s.positionCode}-${i}`} style={{ background: s.isCurrent ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : undefined }}>
                      <td>{i + 1}</td>
                      <td>
                        {s.positionName}
                        {s.label !== 'Approval' && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{s.label}</div>}
                      </td>
                      <td>{s.people.length ? s.people.map((p) => p.name).join(', ') : '-'}</td>
                      <td>{s.people.length ? s.people.map((p) => p.email).join(', ') : '-'}</td>
                      <td>
                        <span className={`badge ${stageBadge(s.status)}`}>{s.status}</span>
                        {s.isCurrent && <span style={{ marginLeft: 6, fontSize: 11 }}>next</span>}
                      </td>
                    </tr>
                  ))}
                  {trail.stages.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--muted)' }}>
                        No approval steps
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
