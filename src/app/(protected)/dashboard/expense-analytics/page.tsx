'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import DatePicker from '@/components/DatePicker';
import DonutChart from '@/components/DonutChart';
import SimpleBarChart from '@/components/SimpleBarChart';
import PodExpenseSettlementChart from '@/components/PodExpenseSettlementChart';
import DualAmountTrendChart from '@/components/DualAmountTrendChart';

interface Summary {
  totalExpense: number;
  totalExpenseCount: number;
  totalSettled: number;
  totalSettledCount: number;
  outstanding: number;
  outstandingCount: number;
  settlementRate: number;
  waitingApprovalAmount: number;
  waitingApprovalCount: number;
  averageProcessingDays: number;
  previous: { totalExpense: number; totalSettled: number; settlementRate: number; averageProcessingDays: number } | null;
}

interface PodRow {
  id: string;
  name: string;
  totalExpense: number;
  settled: number;
  outstanding: number;
  transactionCount: number;
}

interface CategoryRow {
  id: string;
  name: string;
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
  totalExpense: number;
  settled: number;
}

interface ReconciliationRow {
  id: string;
  expenseNo: string;
  podName: string;
  submitterName: string;
  expenseAmount: number;
  settlementNo: string | null;
  settledAmount: number;
  outstanding: number;
  settlementStatus: string | null;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface CategoryOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  'DRAFT',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVAL_HEAD_POD',
  'APPROVAL_KOORDINATOR',
  'APPROVAL_SUPERVISOR',
  'APPROVAL_DEPT_HEAD',
  'APPROVAL_DIV_HEAD',
  'APPROVAL_BOD',
  'APPROVAL_CO_CSO_1',
  'APPROVAL_CO_CSO_2',
  'REJECTED',
  'REVISION',
  'READY_TO_MATCHING',
  'READY_TO_SETTLED',
  'COMPLETE',
];

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

function pctDelta(current: number, previous: number | undefined): number | null {
  if (previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// higherIsBetter=true -> an increase renders green; false -> a decrease renders green.
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

function ReconciliationStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="badge badge-danger">Not Settled</span>;
  const cls = status === 'COMPLETE' ? 'badge-success' : status === 'REJECTED' ? 'badge-danger' : status === 'DRAFT' ? 'badge-info' : 'badge-warning';
  const label = status === 'COMPLETE' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : status === 'DRAFT' ? 'Draft' : 'Waiting Approval';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function ExpenseAnalyticsDashboardPage() {
  const [draftFrom, setDraftFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [draftTo, setDraftTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [draftDepartmentId, setDraftDepartmentId] = useState('');
  const [draftCategoryId, setDraftCategoryId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');

  const [appliedFilter, setAppliedFilter] = useState({ from: draftFrom, to: draftTo, departmentId: '', categoryId: '', status: '' });

  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [byPod, setByPod] = useState<PodRow[]>([]);
  const [byCategory, setByCategory] = useState<CategoryRow[]>([]);
  const [statusRows, setStatusRows] = useState<StatusRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DepartmentOption[]>('/departments?active=true').then(setDepartmentOptions).catch(() => undefined);
    api.get<CategoryOption[]>('/expense-categories?active=true').then(setCategoryOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    const qs = buildQuery(appliedFilter);
    setLoading(true);
    Promise.all([
      api.get<Summary>(`/dashboard/expense-settlement-summary${qs}`),
      api.get<PodRow[]>(`/dashboard/expense-vs-settlement-by-pod${qs}`),
      api.get<CategoryRow[]>(`/dashboard/expense-by-category${qs}`),
      api.get<StatusRow[]>(`/dashboard/settlement-status${qs}`),
      api.get<TrendRow[]>(`/dashboard/expense-settlement-trend${qs}`),
      api.get<ReconciliationRow[]>(`/dashboard/expense-settlement-reconciliation${qs ? `${qs}&limit=5` : '?limit=5'}`),
    ])
      .then(([s, pod, category, status, tr, recon]) => {
        setSummary(s);
        setByPod(pod);
        setByCategory(category);
        setStatusRows(status);
        setTrend(tr);
        setReconciliation(recon);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load expense analytics'))
      .finally(() => setLoading(false));
  }, [appliedFilter]);

  const applyFilter = () => {
    setAppliedFilter({ from: draftFrom, to: draftTo, departmentId: draftDepartmentId, categoryId: draftCategoryId, status: draftStatus });
  };

  const clearFilter = () => {
    setDraftDepartmentId('');
    setDraftCategoryId('');
    setDraftStatus('');
    setAppliedFilter((f) => ({ ...f, departmentId: '', categoryId: '', status: '' }));
  };

  const hasAppliedFilter = !!(appliedFilter.departmentId || appliedFilter.categoryId || appliedFilter.status);

  // No PDF-generation library on the backend (see CLAUDE.md) - build a
  // printable summary client-side and let the browser's print dialog "Save as
  // PDF" handle the export, same approach as the Expense Dashboard's Export Report.
  const exportReport = () => {
    if (!summary) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = reconciliation
      .map(
        (r) => `<tr>
          <td>${r.expenseNo}</td>
          <td>${r.podName} — ${r.submitterName}</td>
          <td>${formatCurrency(Number(r.expenseAmount))}</td>
          <td>${r.settlementNo ?? '-'}</td>
          <td>${formatCurrency(r.settledAmount)}</td>
          <td>${formatCurrency(r.outstanding)}</td>
          <td>${r.settlementStatus ?? 'Not Settled'}</td>
        </tr>`,
      )
      .join('');
    win.document.write(`<!doctype html><html><head><title>Expense Analytics Dashboard Report</title><style>
      body { font-family: sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
      .stats { display: flex; gap: 16px; flex-wrap: wrap; }
      .stats div { border: 1px solid #ccc; padding: 8px 12px; border-radius: 6px; }
    </style></head><body>
      <h2>Expense Analytics Dashboard</h2>
      <div>${draftFrom} &ndash; ${draftTo}</div>
      <div class="stats">
        <div>Total Expenses<br/><strong>${formatCurrency(summary.totalExpense)}</strong></div>
        <div>Total Settled<br/><strong>${formatCurrency(summary.totalSettled)}</strong></div>
        <div>Outstanding<br/><strong>${formatCurrency(summary.outstanding)}</strong></div>
        <div>Settlement Rate<br/><strong>${summary.settlementRate.toFixed(1)}%</strong></div>
        <div>Waiting Approval<br/><strong>${formatCurrency(summary.waitingApprovalAmount)}</strong></div>
        <div>Average Processing Time<br/><strong>${summary.averageProcessingDays.toFixed(1)} Days</strong></div>
      </div>
      <h3>Expense &amp; Settlement Reconciliation</h3>
      <table><thead><tr>
        <th>Expense No</th><th>POD / Submitter</th><th>Expense Amount</th><th>Settlement No</th>
        <th>Settled Amount</th><th>Outstanding</th><th>Settlement Status</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const conversionDonutRows = summary
    ? [
        { id: 'settled', label: 'Settled', value: summary.totalSettled, color: '#3fd085' },
        { id: 'outstanding', label: 'Outstanding', value: summary.outstanding, color: '#f7b955' },
      ].filter((r) => r.value > 0)
    : [];

  const statusDonutRows = statusRows.map((s) => ({ id: s.key, label: s.label, value: s.count, color: s.color }));

  const outstandingByPodRows = [...byPod]
    .sort((a, b) => b.outstanding - a.outstanding)
    .map((p) => ({ id: p.id, name: p.name, value: p.outstanding }));

  const categoryBarRows = byCategory.map((c) => ({ id: c.id, name: c.name, value: Number(c.totalExpense) }));

  // Executive Insights - derived client-side from data already fetched for
  // the other panels rather than a dedicated endpoint.
  const insights: { icon: string; color: string; text: string }[] = [];
  if (byPod.length > 0) {
    const withRate = byPod.map((p) => ({ ...p, rate: p.totalExpense > 0 ? (p.settled / p.totalExpense) * 100 : 0 }));
    const lowest = withRate.reduce((min, p) => (p.rate < min.rate ? p : min), withRate[0]);
    insights.push({ icon: '⚠', color: 'var(--danger)', text: `${lowest.name} has the lowest settlement rate: ${lowest.rate.toFixed(1)}%` });
    const highestOutstanding = [...byPod].sort((a, b) => b.outstanding - a.outstanding)[0];
    if (highestOutstanding.outstanding > 0) {
      insights.push({ icon: '!', color: 'var(--warning)', text: `${highestOutstanding.name} has ${formatCompactCurrency(highestOutstanding.outstanding)} outstanding` });
    }
  }
  if (byCategory.length > 0) {
    insights.push({ icon: '📊', color: 'var(--info, #5ec8f2)', text: `${byCategory[0].name} is the highest expense category` });
  }

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 style={{ marginBottom: 2 }}>Expense Analytics Dashboard</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Integrated analysis of expenses, settlement progress, and outstanding exposure</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <DatePicker value={draftFrom} onChange={setDraftFrom} style={{ width: 135 }} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
          <DatePicker value={draftTo} onChange={setDraftTo} style={{ width: 135 }} />
          <select value={draftDepartmentId} onChange={(e) => setDraftDepartmentId(e.target.value)} style={{ width: 140 }}>
            <option value="">All POD</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={draftCategoryId} onChange={(e) => setDraftCategoryId(e.target.value)} style={{ width: 150 }}>
            <option value="">All Categories</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} style={{ width: 150 }}>
            <option value="">All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
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
              <div className="label">Total Expenses</div>
              <div className="value">{formatCurrency(summary.totalExpense)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.totalExpenseCount} transactions</div>
            </div>
            <div className="stat">
              <div className="label">Total Settled</div>
              <div className="value" style={{ color: 'var(--success)' }}>
                {formatCurrency(summary.totalSettled)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.totalSettledCount} transactions</div>
            </div>
            <div className="stat">
              <div className="label">Outstanding</div>
              <div className="value" style={{ color: 'var(--warning)' }}>
                {formatCurrency(summary.outstanding)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.outstandingCount} transactions</div>
            </div>
            <div className="stat">
              <div className="label">Settlement Rate</div>
              <div className="value">{summary.settlementRate.toFixed(1)}%</div>
              <DeltaBadge value={pctDelta(summary.settlementRate, summary.previous?.settlementRate)} higherIsBetter />
            </div>
            <div className="stat">
              <div className="label">Waiting Approval</div>
              <div className="value" style={{ color: 'var(--warning)' }}>
                {formatCurrency(summary.waitingApprovalAmount)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.waitingApprovalCount} transactions</div>
            </div>
            <div className="stat">
              <div className="label">Average Processing Time</div>
              <div className="value">{summary.averageProcessingDays.toFixed(1)} Days</div>
              <DeltaBadge
                value={summary.previous ? summary.averageProcessingDays - summary.previous.averageProcessingDays : null}
                higherIsBetter={false}
                unit=" day"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div className="card">
              <h3>Expenses vs Settlement by POD</h3>
              <PodExpenseSettlementChart data={byPod} />
            </div>
            <div className="card">
              <h3>Expense to Settlement Conversion</h3>
              <DonutChart data={conversionDonutRows} centerLabel="Settlement Rate" formatValue={formatCompactCurrency} />
            </div>
            <div className="card">
              <h3>Monthly Expense vs Settlement Trend</h3>
              <DualAmountTrendChart data={trend} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <div className="card">
              <h3>Outstanding by POD</h3>
              <SimpleBarChart data={outstandingByPodRows} formatValue={formatCompactCurrency} color="#ef5da8" />
            </div>
            <div className="card">
              <h3>Expense by Category</h3>
              <SimpleBarChart data={categoryBarRows} formatValue={formatCompactCurrency} />
            </div>
            <div className="card">
              <h3>Settlement Status</h3>
              <DonutChart data={statusDonutRows} centerLabel="Total Transactions" formatValue={(v) => String(v)} />
            </div>
            <div className="card">
              <h3>Executive Insights</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insights.map((ins, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                      borderLeft: `3px solid ${ins.color}`,
                    }}
                  >
                    <span style={{ color: ins.color, fontWeight: 700 }}>{ins.icon}</span>
                    <span style={{ fontSize: 12.5 }}>{ins.text}</span>
                  </div>
                ))}
                {insights.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>No insights for this period</div>}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <div className="card">
              <div className="toolbar" style={{ marginBottom: 4 }}>
                <h3 style={{ margin: 0 }}>Expense &amp; Settlement Reconciliation</h3>
                <Link href="/expenses">View All</Link>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Expense No.</th>
                    <th>POD / Submitter</th>
                    <th>Expense Amount</th>
                    <th>Settlement No.</th>
                    <th>Settled Amount</th>
                    <th>Outstanding</th>
                    <th>Settlement Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/expenses/${r.id}`}>{r.expenseNo}</Link>
                      </td>
                      <td>
                        {r.podName}
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.submitterName}</div>
                      </td>
                      <td>{formatCurrency(Number(r.expenseAmount))}</td>
                      <td>{r.settlementNo ?? '—'}</td>
                      <td>{formatCurrency(r.settledAmount)}</td>
                      <td>{formatCurrency(r.outstanding)}</td>
                      <td>
                        <ReconciliationStatusBadge status={r.settlementStatus} />
                      </td>
                      <td>
                        <Link href={`/expenses/${r.id}`} className="btn">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {reconciliation.length === 0 && (
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
