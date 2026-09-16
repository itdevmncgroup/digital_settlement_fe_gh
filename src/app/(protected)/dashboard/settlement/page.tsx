'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import DatePicker from '@/components/DatePicker';
import DepartmentExpenseChart from '@/components/DepartmentExpenseChart';
import TransactionTrendChart from '@/components/TransactionTrendChart';
import StatusBreakdownChart from '@/components/StatusBreakdownChart';
import ApprovalProgressBar from '@/components/ApprovalProgressBar';
import SimpleBarChart from '@/components/SimpleBarChart';

interface SettlementSummary {
  totalAmount: number;
  totalTransactions: number;
  approvedAmount: number;
  approvedCount: number;
  waitingApprovalAmount: number;
  waitingApprovalCount: number;
  rejectedAmount: number;
  rejectedCount: number;
  averageProcessingDays: number;
  previous: { totalAmount: number; totalTransactions: number; averageProcessingDays: number } | null;
}

interface GroupRow {
  id: string;
  name: string;
  subtitle?: string;
  totalExpense: number;
  transactionCount: number;
}

interface StatusRow {
  key: string;
  label: string;
  count: number;
  color: string;
}

interface TrendRow {
  month: string;
  total: number;
  count: number;
}

interface ApprovalProgressRow {
  level: number;
  positionName: string;
  approvedPct: number;
  waitingPct: number;
  rejectedPct: number;
}

interface ProcessingTimeRow {
  id: string;
  name: string;
  averageDays: number;
}

interface RecentSettlementRow {
  id: string;
  settlementNo: string;
  period: string;
  departmentName: string;
  submitterName: string;
  transactionCount: number;
  totalAmount: number;
  approvalLevel: string;
  status: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = ['DRAFT', 'APPROVAL_SLS_MAR_DIR', 'APPROVAL_VP_ACC_BIL_TAX_3TV', 'APPROVAL_CO_CFO_3TV', 'COMPLETE', 'REJECTED'];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function buildQuery(params: Record<string, string>) {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qp.set(k, v);
  }
  const qs = qp.toString();
  return qs ? `?${qs}` : '';
}

function pctDelta(current: number, previous: number | undefined): number | null {
  if (previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// higherIsBetter=true -> an increase renders green (more settlement volume is
// good); false -> a decrease renders green (faster processing is good).
function DeltaBadge({ value, higherIsBetter, unit = '%' }: { value: number | null; higherIsBetter: boolean; unit?: string }) {
  if (value === null) return null;
  const isUp = value > 0;
  const isGood = higherIsBetter ? isUp : !isUp;
  const color = value === 0 ? 'var(--muted)' : isGood ? 'var(--success)' : 'var(--danger)';
  const arrow = value === 0 ? '·' : isUp ? '↑' : '↓';
  return (
    <span style={{ fontSize: 12, color, fontWeight: 600 }}>
      {arrow} {Math.abs(value).toFixed(1)}
      {unit} vs previous period
    </span>
  );
}

function SettlementStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'COMPLETE'
      ? 'badge-success'
      : status === 'REJECTED'
      ? 'badge-danger'
      : status === 'DRAFT'
      ? 'badge-info'
      : 'badge-warning';
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default function SettlementDashboardPage() {
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [draftDepartmentId, setDraftDepartmentId] = useState('');
  const [draftSubmitterId, setDraftSubmitterId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');

  const [appliedFilter, setAppliedFilter] = useState({ from: '', to: '', departmentId: '', submitterId: '', status: '' });

  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);

  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [byPod, setByPod] = useState<GroupRow[]>([]);
  const [statusRows, setStatusRows] = useState<StatusRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [topSubmitters, setTopSubmitters] = useState<GroupRow[]>([]);
  const [approvalProgress, setApprovalProgress] = useState<ApprovalProgressRow[]>([]);
  const [processingTimeByPod, setProcessingTimeByPod] = useState<ProcessingTimeRow[]>([]);
  const [recentSettlements, setRecentSettlements] = useState<RecentSettlementRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DepartmentOption[]>('/departments?active=true').then(setDepartmentOptions).catch(() => undefined);
    api.get<UserOption[]>('/users').then(setUserOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    const qs = buildQuery(appliedFilter);
    setLoading(true);
    Promise.all([
      api.get<SettlementSummary>(`/dashboard/settlement-summary${qs}`),
      api.get<GroupRow[]>(`/dashboard/settlement-by-pod${qs}`),
      api.get<StatusRow[]>(`/dashboard/settlement-status${qs}`),
      api.get<TrendRow[]>(`/dashboard/settlement-trend${qs}`),
      api.get<GroupRow[]>(`/dashboard/settlement-top-submitters${qs}`),
      api.get<ApprovalProgressRow[]>(`/dashboard/settlement-approval-progress${qs}`),
      api.get<ProcessingTimeRow[]>(`/dashboard/settlement-processing-time-by-pod${qs}`),
      api.get<RecentSettlementRow[]>(`/dashboard/settlement-transactions${qs ? `${qs}&limit=10` : '?limit=10'}`),
    ])
      .then(([s, pod, status, tr, top, progress, processing, recent]) => {
        setSummary(s);
        setByPod(pod);
        setStatusRows(status);
        setTrend(tr);
        setTopSubmitters(top);
        setApprovalProgress(progress);
        setProcessingTimeByPod(processing);
        setRecentSettlements(recent);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load settlement dashboard'))
      .finally(() => setLoading(false));
  }, [appliedFilter]);

  const applyFilter = () => {
    setAppliedFilter({ from: draftFrom, to: draftTo, departmentId: draftDepartmentId, submitterId: draftSubmitterId, status: draftStatus });
  };

  const clearFilter = () => {
    setDraftFrom('');
    setDraftTo('');
    setDraftDepartmentId('');
    setDraftSubmitterId('');
    setDraftStatus('');
    setAppliedFilter({ from: '', to: '', departmentId: '', submitterId: '', status: '' });
  };

  const hasAppliedFilter = Object.values(appliedFilter).some(Boolean);

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 style={{ marginBottom: 2 }}>Settlement Dashboard</h1>
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>Executive overview of settlement performance and approval progress</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            From
            <DatePicker value={draftFrom} onChange={setDraftFrom} style={{ width: 150 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            To
            <DatePicker value={draftTo} onChange={setDraftTo} style={{ width: 150 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            POD
            <select value={draftDepartmentId} onChange={(e) => setDraftDepartmentId(e.target.value)} style={{ width: 180 }}>
              <option value="">All POD</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            Submitter
            <select value={draftSubmitterId} onChange={(e) => setDraftSubmitterId(e.target.value)} style={{ width: 180 }}>
              <option value="">All Submitters</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            Status
            <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} style={{ width: 200 }}>
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={applyFilter}>
            Filter
          </button>
          {hasAppliedFilter && (
            <button className="btn" onClick={clearFilter}>
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && !summary ? (
        <div>Loading...</div>
      ) : summary ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Total Settlement</div>
              <div className="value">{formatCurrency(Number(summary.totalAmount))}</div>
              <DeltaBadge value={pctDelta(Number(summary.totalAmount), summary.previous?.totalAmount)} higherIsBetter />
            </div>
            <div className="stat">
              <div className="label">Total Transactions</div>
              <div className="value">{summary.totalTransactions}</div>
              <DeltaBadge value={pctDelta(summary.totalTransactions, summary.previous?.totalTransactions)} higherIsBetter />
            </div>
            <div className="stat">
              <div className="label">Approved Settlement</div>
              <div className="value" style={{ color: 'var(--success)' }}>
                {formatCurrency(Number(summary.approvedAmount))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.approvedCount} transactions</div>
            </div>
            <div className="stat">
              <div className="label">Waiting Approval</div>
              <div className="value" style={{ color: 'var(--warning)' }}>
                {formatCurrency(Number(summary.waitingApprovalAmount))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.waitingApprovalCount} transactions</div>
            </div>
            <div className="stat">
              <div className="label">Rejected Settlement</div>
              <div className="value" style={{ color: 'var(--danger)' }}>
                {formatCurrency(Number(summary.rejectedAmount))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.rejectedCount} transactions</div>
            </div>
            <div className="stat">
              <div className="label">Average Processing Time</div>
              <div className="value">{summary.averageProcessingDays.toFixed(1)} Days</div>
              <DeltaBadge
                value={
                  summary.previous
                    ? summary.averageProcessingDays - summary.previous.averageProcessingDays
                    : null
                }
                higherIsBetter={false}
                unit=" day"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div className="card">
              <h3>Settlement by POD &amp; Submitter</h3>
              <DepartmentExpenseChart data={byPod} />
            </div>
            <div className="card">
              <h3>Settlement Status</h3>
              <StatusBreakdownChart data={statusRows} />
            </div>
            <div className="card">
              <h3>Settlement Trend</h3>
              <TransactionTrendChart data={trend} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div className="card">
              <h3>Top Submitters</h3>
              <DepartmentExpenseChart data={topSubmitters} />
            </div>
            <div className="card">
              <h3>Approval Progress</h3>
              <ApprovalProgressBar data={approvalProgress} />
            </div>
            <div className="card">
              <h3>Average Processing Time by POD</h3>
              <SimpleBarChart data={processingTimeByPod.map((p) => ({ id: p.id, name: p.name, value: p.averageDays }))} valueSuffix="d" color="#5ec8f2" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <div className="card">
              <h3>Settlement Transactions</h3>
              <table>
                <thead>
                  <tr>
                    <th>Settlement No.</th>
                    <th>Period</th>
                    <th>POD / Submitter</th>
                    <th>Transaction Count</th>
                    <th>Total Amount</th>
                    <th>Approval Level</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSettlements.map((r) => (
                    <tr key={r.id}>
                      <td>{r.settlementNo}</td>
                      <td>{r.period}</td>
                      <td>
                        {r.departmentName}
                        <span style={{ color: 'var(--muted)' }}> — {r.submitterName}</span>
                      </td>
                      <td>{r.transactionCount}</td>
                      <td>{formatCurrency(Number(r.totalAmount))}</td>
                      <td>{r.approvalLevel}</td>
                      <td>
                        <SettlementStatusBadge status={r.status} />
                      </td>
                      <td>
                        <Link href="/settlement" className="btn">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {recentSettlements.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ color: 'var(--muted)' }}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
