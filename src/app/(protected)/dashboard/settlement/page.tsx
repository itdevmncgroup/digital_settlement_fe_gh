'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import DatePicker from '@/components/DatePicker';
import DepartmentExpenseChart from '@/components/DepartmentExpenseChart';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import StatusSummaryChart, { StatusSummaryRow } from '@/components/StatusSummaryChart';
import ApprovalProgressBar from '@/components/ApprovalProgressBar';
import ProcessingTimeChart from '@/components/ProcessingTimeChart';

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
  count?: number;
  minDays?: number;
  maxDays?: number;
}

interface DepartmentOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'REJECTED', label: 'Rejected' },
];

// From = one month ago, To = today (yyyy-mm-dd, what the date pickers hold).
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}
function defaultFromDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

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

export default function SettlementDashboardPage() {
  const { hasRole, hasPermission } = useAuth();
  const canViewAllDepartments = hasRole('ADMINISTRATOR') || hasPermission('dashboard.read.all');

  // Default period: the last month up to today.
  const [draftFrom, setDraftFrom] = useState(defaultFromDate);
  const [draftTo, setDraftTo] = useState(defaultToDate);
  const [draftDepartmentId, setDraftDepartmentId] = useState('');
  const [draftUnitId, setDraftUnitId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');

  const [appliedFilter, setAppliedFilter] = useState({ from: draftFrom, to: draftTo, departmentId: '', requestorUnitId: '', status: '' });

  const [unitOptions, setUnitOptions] = useState<{ id: string; name: string }[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);

  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [byPod, setByPod] = useState<GroupRow[]>([]);
  const [statusRows, setStatusRows] = useState<StatusSummaryRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [approvalProgress, setApprovalProgress] = useState<ApprovalProgressRow[]>([]);
  const [processingTimeByPod, setProcessingTimeByPod] = useState<ProcessingTimeRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = canViewAllDepartments ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
    api.get<{ id: string; name: string }[]>('/units?active=true').then(setUnitOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAllDepartments]);

  useEffect(() => {
    const qs = buildQuery(appliedFilter);
    setLoading(true);
    Promise.all([
      api.get<SettlementSummary>(`/dashboard/settlement-summary${qs}`),
      api.get<GroupRow[]>(`/dashboard/settlement-by-pod${qs}`),
      api.get<StatusSummaryRow[]>(`/dashboard/settlement-status-summary${qs}`),
      api.get<TrendRow[]>(`/dashboard/settlement-trend${qs}`),
      api.get<ApprovalProgressRow[]>(`/dashboard/settlement-approval-progress${qs}`),
      api.get<ProcessingTimeRow[]>(`/dashboard/settlement-processing-time-by-pod${qs}`),
    ])
      .then(([s, pod, status, tr, progress, processing]) => {
        setSummary(s);
        setByPod(pod);
        setStatusRows(status);
        setTrend(tr);
        setApprovalProgress(progress);
        setProcessingTimeByPod(processing);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load settlement dashboard'))
      .finally(() => setLoading(false));
  }, [appliedFilter]);

  const applyFilter = () => {
    setAppliedFilter({ from: draftFrom, to: draftTo, departmentId: draftDepartmentId, requestorUnitId: draftUnitId, status: draftStatus });
  };

  // Clear puts everything back to the defaults, including the last-month period.
  const clearFilter = () => {
    const from = defaultFromDate();
    const to = defaultToDate();
    setDraftFrom(from);
    setDraftTo(to);
    setDraftDepartmentId('');
    setDraftUnitId('');
    setDraftStatus('');
    setAppliedFilter({ from, to, departmentId: '', requestorUnitId: '', status: '' });
  };

  // The period alone is not a filter - it always has a value (default: the last month).
  const hasAppliedFilter = !!(appliedFilter.departmentId || appliedFilter.requestorUnitId || appliedFilter.status);

  // The period the data was loaded for (the applied filter, not the pickers' unsaved edits).
  const periodLabel =
    appliedFilter.from && appliedFilter.to
      ? `${formatDate(appliedFilter.from)} – ${formatDate(appliedFilter.to)}`
      : appliedFilter.from
        ? `from ${formatDate(appliedFilter.from)}`
        : appliedFilter.to
          ? `until ${formatDate(appliedFilter.to)}`
          : 'all time';

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
              <option value="">{canViewAllDepartments ? 'All POD' : 'All my POD'}</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            Unit (requestor)
            <select value={draftUnitId} onChange={(e) => setDraftUnitId(e.target.value)} style={{ width: 180 }}>
              <option value="">All Units</option>
              {unitOptions.map((u) => (
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
                <option key={s.value} value={s.value}>
                  {s.label}
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <h3>Settlement by POD</h3>
              <DepartmentExpenseChart data={byPod.map((p) => ({ ...p, subtitle: undefined }))} />
            </div>
            <div className="card">
              <h3>Settlement Status</h3>
              <StatusSummaryChart data={statusRows} selectedKey={appliedFilter.status || undefined} />
            </div>
          </div>

          <div className="card">
            <h3>Settlement Trend per Month</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>{periodLabel}</div>
            <MonthlyTrendChart data={trend} from={appliedFilter.from} to={appliedFilter.to} amountLabel="Total Settlement" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <h3>Approval Progress</h3>
              <ApprovalProgressBar data={approvalProgress} />
            </div>
            <div className="card">
              <h3>Average Processing Time by POD</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>
                Settlement created → sent to Odoo · {periodLabel}
              </div>
              <ProcessingTimeChart data={processingTimeByPod} periodLabel={periodLabel} />
            </div>
          </div>

        </>
      ) : null}
    </div>
  );
}
