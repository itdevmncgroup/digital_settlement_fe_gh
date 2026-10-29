'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import ActivityTypeExpenseChart from '@/components/ActivityTypeExpenseChart';
import DatePicker from '@/components/DatePicker';
import DepartmentExpenseChart from '@/components/DepartmentExpenseChart';
import DonutChart from '@/components/DonutChart';
import GroupTransactionList from '@/components/GroupTransactionList';
import GroupDetailModal from '@/components/GroupDetailModal';
import StatusSummaryChart, { StatusSummaryRow } from '@/components/StatusSummaryChart';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';

interface Summary {
  totalExpense: number;
  totalTransaction: number;
  averageExpense: number;
  approved: number;
  pending: number;
  rejected: number;
  draft: number;
  highestExpensePod: { id: string; name: string; totalExpense: number } | null;
  pendingApprovalCount: number;
  pendingApprovalAmount: number;
  rejectedCount: number;
  rejectedAmount: number;
  previous: { totalExpense: number; totalTransaction: number; averageExpense: number } | null;
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

interface DepartmentOption {
  id: string;
  name: string;
}

interface ActivityTypeOption {
  id: string;
  name: string;
}

// Grouped buckets (the dashboard API maps each to every concrete status in it).
const STATUS_OPTIONS = [
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'REJECTED', label: 'Rejected' },
];

// Agency / Advertiser cards show only the top N; the "More" popup has the full ranking.
const TOP_N = 5;

const DONUT_COLORS = ['#8b7bfb', '#ef5da8', '#3fd085', '#f7b955', '#5ec8f2', '#ff8a5c', '#c68bff', '#4fd1c5'];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(0)}Jt`;
  if (abs >= 1_000) return `Rp${(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

function buildQuery(params: Record<string, string>) {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qp.set(k, v);
  }
  const qs = qp.toString();
  return qs ? `?${qs}` : '';
}

// vs-previous-period delta line, e.g. "↑ 8.4% vs previous period" - omitted
// entirely when there's no previous value to compare against (previous === 0,
// which can't be meaningfully turned into a percentage change).
function DeltaLine({ current, previous }: { current: number; previous: number | undefined }) {
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  return (
    <div style={{ fontSize: 12, marginTop: 2, color: up ? 'var(--success)' : 'var(--danger)' }}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% <span style={{ color: 'var(--muted)' }}>vs previous period</span>
    </div>
  );
}

export default function ExpenseDashboardPage() {
  const { hasRole, hasPermission } = useAuth();
  const canViewAllDepartments = hasRole('ADMINISTRATOR') || hasPermission('dashboard.read.all');

  const [draftFrom, setDraftFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [draftTo, setDraftTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [draftDepartmentId, setDraftDepartmentId] = useState('');
  const [draftUnitId, setDraftUnitId] = useState('');
  const [draftActivityTypeId, setDraftActivityTypeId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');

  const [appliedFilter, setAppliedFilter] = useState({ from: draftFrom, to: draftTo, departmentId: '', requestorUnitId: '', activityTypeId: '', status: '' });

  const [unitOptions, setUnitOptions] = useState<{ id: string; name: string }[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [activityTypeOptions, setActivityTypeOptions] = useState<ActivityTypeOption[]>([]);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [byAgency, setByAgency] = useState<GroupRow[]>([]);
  const [byAdvertiser, setByAdvertiser] = useState<GroupRow[]>([]);
  const [byActivityType, setByActivityType] = useState<GroupRow[]>([]);
  const [byPod, setByPod] = useState<GroupRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [statusRows, setStatusRows] = useState<StatusSummaryRow[]>([]);
  // Which Top-5 card's "More" popup is open.
  const [moreOpen, setMoreOpen] = useState<'agency' | 'advertiser' | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = canViewAllDepartments ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
    api.get<ActivityTypeOption[]>('/activity-types?active=true').then(setActivityTypeOptions).catch(() => undefined);
    api.get<{ id: string; name: string }[]>('/units?active=true').then(setUnitOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAllDepartments]);

  useEffect(() => {
    const qs = buildQuery(appliedFilter);
    setLoading(true);
    Promise.all([
      api.get<Summary>(`/dashboard/summary${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-agency${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-advertiser${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-activity-type${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-department${qs}`),
      api.get<TrendRow[]>(`/dashboard/expense-by-month${qs}`),
      api.get<StatusSummaryRow[]>(`/dashboard/expense-status${qs}`),
    ])
      .then(([s, agency, advertiser, activityType, pod, t, st]) => {
        setSummary(s);
        setByAgency(agency);
        setByAdvertiser(advertiser);
        setByActivityType(activityType);
        setByPod(pod);
        setTrend(t);
        setStatusRows(st);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [appliedFilter]);

  const applyFilter = () => {
    setAppliedFilter({ from: draftFrom, to: draftTo, departmentId: draftDepartmentId, requestorUnitId: draftUnitId, activityTypeId: draftActivityTypeId, status: draftStatus });
  };

  const clearFilter = () => {
    setDraftDepartmentId('');
    setDraftUnitId('');
    setDraftActivityTypeId('');
    setDraftStatus('');
    setAppliedFilter((f) => ({ ...f, departmentId: '', requestorUnitId: '', activityTypeId: '', status: '' }));
  };

  const hasAppliedFilter = !!(appliedFilter.departmentId || appliedFilter.requestorUnitId || appliedFilter.activityTypeId || appliedFilter.status);

  // No PDF-generation library on the backend (see CLAUDE.md) - build a
  // printable summary client-side and let the browser's print dialog "Save as
  // PDF" handle the export, same approach as the Expenses list's Export to PDF.
  const exportReport = () => {
    if (!summary) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const topTable = (title: string, data: GroupRow[], showPic = true) => `<h3>${title}</h3>
      <table><thead><tr><th>#</th><th>Name</th>${showPic ? '<th>PIC</th>' : ''}<th>Transactions</th><th>Total Expense</th></tr></thead><tbody>${data
        .slice(0, TOP_N)
        .map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td>${showPic ? `<td>${r.subtitle ?? '-'}</td>` : ''}<td>${r.transactionCount}</td><td>${formatCurrency(Number(r.totalExpense))}</td></tr>`)
        .join('')}</tbody></table>`;
    win.document.write(`<!doctype html><html><head><title>Expense Dashboard Report</title><style>
      body { font-family: sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
      .stats { display: flex; gap: 16px; flex-wrap: wrap; }
      .stats div { border: 1px solid #ccc; padding: 8px 12px; border-radius: 6px; }
    </style></head><body>
      <h2>All Expense Dashboard</h2>
      <div>${draftFrom} &ndash; ${draftTo}</div>
      <div class="stats">
        <div>Total Expense<br/><strong>${formatCurrency(summary.totalExpense)}</strong></div>
        <div>Total Transactions<br/><strong>${summary.totalTransaction}</strong></div>
        <div>Average per Transaction<br/><strong>${formatCurrency(summary.averageExpense)}</strong></div>
        <div>Pending Approval<br/><strong>${summary.pendingApprovalCount} (${formatCurrency(summary.pendingApprovalAmount)})</strong></div>
        <div>Rejected<br/><strong>${summary.rejectedCount} (${formatCurrency(summary.rejectedAmount)})</strong></div>
      </div>
      ${topTable('Top 5 Expense by Agency', byAgency, false)}
      ${topTable('Top 5 Expense by Advertiser', byAdvertiser, false)}
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const topAgencies = byAgency.slice(0, TOP_N);
  const topAdvertisers = byAdvertiser.slice(0, TOP_N);

  const agencyDonutRows = topAgencies.map((row, i) => ({
    id: row.id,
    label: row.name,
    value: Number(row.totalExpense),
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));

  const advertiserDonutRows = topAdvertisers.map((row, i) => ({
    id: row.id,
    label: row.name,
    value: Number(row.totalExpense),
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));

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
          <h1 style={{ marginBottom: 2 }}>All Expense Dashboard</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Executive overview of company expenses and transaction performance</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <DatePicker value={draftFrom} onChange={setDraftFrom} style={{ width: 135 }} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
          <DatePicker value={draftTo} onChange={setDraftTo} style={{ width: 135 }} />
          <select value={draftDepartmentId} onChange={(e) => setDraftDepartmentId(e.target.value)} style={{ width: 140 }}>
            <option value="">{canViewAllDepartments ? 'All POD' : 'All my POD'}</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={draftUnitId} onChange={(e) => setDraftUnitId(e.target.value)} style={{ width: 170 }}>
            <option value="">All Units (requestor)</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select value={draftActivityTypeId} onChange={(e) => setDraftActivityTypeId(e.target.value)} style={{ width: 150 }}>
            <option value="">All Activity Types</option>
            {activityTypeOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} style={{ width: 150 }}>
            <option value="">All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={applyFilter}>
            Filter
          </button>
          {hasAppliedFilter && (
            <button className="btn" onClick={clearFilter}>
              Clear
            </button>
          )}
          <button className="btn btn-primary" onClick={exportReport} disabled={!summary}>
            Export Report
          </button>
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && !summary ? (
        <div>Loading...</div>
      ) : summary ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Total Expense</div>
              <div className="value">{formatCurrency(Number(summary.totalExpense))}</div>
              <DeltaLine current={Number(summary.totalExpense)} previous={summary.previous?.totalExpense} />
            </div>
            <div className="stat">
              <div className="label">Total Transactions</div>
              <div className="value">{summary.totalTransaction}</div>
              <DeltaLine current={summary.totalTransaction} previous={summary.previous?.totalTransaction} />
            </div>
            <div className="stat">
              <div className="label">Average per Transaction</div>
              <div className="value">{formatCurrency(Number(summary.averageExpense))}</div>
              <DeltaLine current={Number(summary.averageExpense)} previous={summary.previous?.averageExpense} />
            </div>
            <div className="stat">
              <div className="label">Highest Expense POD</div>
              <div className="value" style={{ fontSize: 18 }}>
                {summary.highestExpensePod ? summary.highestExpensePod.name : '-'}
              </div>
              {summary.highestExpensePod && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                  {formatCurrency(Number(summary.highestExpensePod.totalExpense))}
                </div>
              )}
            </div>
            <div className="stat">
              <div className="label">Pending Approval</div>
              <div className="value" style={{ color: 'var(--warning)' }}>
                {summary.pendingApprovalCount}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                {formatCurrency(Number(summary.pendingApprovalAmount))}
              </div>
            </div>
            <div className="stat">
              <div className="label">Rejected</div>
              <div className="value" style={{ color: 'var(--danger)' }}>
                {summary.rejectedCount}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                {formatCurrency(Number(summary.rejectedAmount))}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div className="card">
              <div className="toolbar" style={{ marginBottom: 4 }}>
                <h3 style={{ margin: 0 }}>Top 5 Expense by Agency</h3>
                <button type="button" className="btn" onClick={() => setMoreOpen('agency')}>
                  More
                </button>
              </div>
              <DonutChart data={agencyDonutRows} centerLabel="Total Expense" legendBelow formatValue={formatCompactCurrency} />
            </div>
            <div className="card">
              <div className="toolbar" style={{ marginBottom: 4 }}>
                <h3 style={{ margin: 0 }}>Top 5 Expense by Advertiser</h3>
                <button type="button" className="btn" onClick={() => setMoreOpen('advertiser')}>
                  More
                </button>
              </div>
              <DonutChart data={advertiserDonutRows} centerLabel="Total Expense" legendBelow formatValue={formatCompactCurrency} />
            </div>
            <div className="card">
              <h3>Expense by Activity Type</h3>
              <ActivityTypeExpenseChart data={byActivityType} periodLabel={periodLabel} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <h3>Expense by POD</h3>
              <DepartmentExpenseChart data={byPod} />
            </div>
            <div className="card">
              <h3>Transaction Status</h3>
              <StatusSummaryChart data={statusRows} selectedKey={appliedFilter.status || undefined} />
            </div>
          </div>

          <div className="card">
            <h3>Transaction Trend per Month</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>{periodLabel}</div>
            <MonthlyTrendChart data={trend} from={appliedFilter.from} to={appliedFilter.to} />
          </div>

        </>
      ) : null}

      {moreOpen === 'agency' && (
        <GroupDetailModal
          title="Expense by Agency"
          rows={byAgency}
          chart="donut"
          showPic={false}
          legendHoverOnly
          showAll
          renderExpanded={(row) => <GroupTransactionList group="agency" id={row.id} query={buildQuery(appliedFilter)} />}
          onClose={() => setMoreOpen(null)}
        />
      )}
      {moreOpen === 'advertiser' && (
        <GroupDetailModal
          title="Expense by Advertiser"
          rows={byAdvertiser}
          chart="donut"
          showPic={false}
          legendHoverOnly
          showAll
          renderExpanded={(row) => <GroupTransactionList group="advertiser" id={row.id} query={buildQuery(appliedFilter)} />}
          onClose={() => setMoreOpen(null)}
        />
      )}
    </div>
  );
}
