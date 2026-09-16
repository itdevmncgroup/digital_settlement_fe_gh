'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/date';
import DatePicker from '@/components/DatePicker';
import DepartmentExpenseChart from '@/components/DepartmentExpenseChart';
import DonutChart from '@/components/DonutChart';
import SimpleBarChart from '@/components/SimpleBarChart';
import TransactionTrendChart from '@/components/TransactionTrendChart';

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

interface RecentTransactionRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  salesName: string;
  departmentName: string;
  agencyName: string;
  advertiserName: string;
  categoryNames: string;
  amount: number;
  status: string;
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
  'APPROVAL_SLS_MAR_DIR',
  'APPROVAL_VP_ACC_BIL_TAX_3TV',
  'APPROVAL_CO_CFO_3TV',
  'REJECTED',
  'REVISION',
  'READY_TO_MATCHING',
  'READY_TO_SETTLED',
  'COMPLETE',
];

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

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'APPROVED' || status === 'SETTLED' || status === 'COMPLETE'
      ? 'badge-success'
      : status === 'REJECTED'
      ? 'badge-danger'
      : status === 'PENDING_APPROVAL' || status.startsWith('APPROVAL_')
      ? 'badge-warning'
      : 'badge-info';
  return <span className={`badge ${cls}`}>{status}</span>;
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
  const [byAgency, setByAgency] = useState<GroupRow[]>([]);
  const [byAdvertiser, setByAdvertiser] = useState<GroupRow[]>([]);
  const [byCategory, setByCategory] = useState<GroupRow[]>([]);
  const [byPod, setByPod] = useState<GroupRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<RecentTransactionRow[]>([]);
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
      api.get<Summary>(`/dashboard/summary${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-agency${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-advertiser${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-category${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-department${qs}`),
      api.get<TrendRow[]>(`/dashboard/expense-by-month${qs}`),
      api.get<RecentTransactionRow[]>(`/dashboard/recent-transactions${qs ? `${qs}&limit=10` : '?limit=10'}`),
    ])
      .then(([s, agency, advertiser, category, pod, t, r]) => {
        setSummary(s);
        setByAgency(agency);
        setByAdvertiser(advertiser);
        setByCategory(category);
        setByPod(pod);
        setTrend(t);
        setRecentTransactions(r);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'))
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
  // PDF" handle the export, same approach as the Expenses list's Export to PDF.
  const exportReport = () => {
    if (!summary) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = recentTransactions
      .map(
        (r) => `<tr>
          <td>${r.expenseNo}</td>
          <td>${formatDate(r.expenseDate)}</td>
          <td>${r.salesName}${r.departmentName !== '-' ? ` / ${r.departmentName}` : ''}</td>
          <td>${r.agencyName}</td>
          <td>${r.advertiserName}</td>
          <td>${r.categoryNames}</td>
          <td>${formatCurrency(r.amount)}</td>
          <td>${r.status}</td>
        </tr>`,
      )
      .join('');
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
      <h3>Recent Transactions</h3>
      <table><thead><tr>
        <th>Expense No</th><th>Date</th><th>Sales/POD</th><th>Agency &amp; PIC</th><th>Advertiser &amp; PIC</th>
        <th>Category</th><th>Amount</th><th>Status</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const statusDonutRows = summary
    ? [
        { id: 'approved', label: 'Approved', value: summary.approved, color: 'var(--success)' },
        { id: 'pending', label: 'Pending', value: summary.pending, color: 'var(--warning)' },
        { id: 'rejected', label: 'Rejected', value: summary.rejected, color: 'var(--danger)' },
        { id: 'draft', label: 'Draft', value: summary.draft, color: '#5ec8f2' },
      ].filter((r) => r.value > 0)
    : [];

  const advertiserDonutRows = byAdvertiser.map((row, i) => ({
    id: row.id,
    label: row.name,
    subtitle: row.subtitle,
    value: Number(row.totalExpense),
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));

  const categoryBarRows = byCategory.map((row) => ({ id: row.id, name: row.name, value: Number(row.totalExpense) }));

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
              <h3>Expense by Agency &amp; PIC</h3>
              <DepartmentExpenseChart data={byAgency} />
            </div>
            <div className="card">
              <h3>Expense by Advertiser &amp; PIC</h3>
              <DonutChart data={advertiserDonutRows} centerLabel="Total Expense" formatValue={formatCompactCurrency} />
            </div>
            <div className="card">
              <h3>Expense by Category</h3>
              <SimpleBarChart data={categoryBarRows} formatValue={formatCompactCurrency} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 1fr', gap: 16 }}>
            <div className="card">
              <h3>Expense by POD</h3>
              <DepartmentExpenseChart data={byPod} />
            </div>
            <div className="card">
              <h3>Transaction Trend</h3>
              <TransactionTrendChart data={trend} />
            </div>
            <div className="card">
              <h3>Transaction Status</h3>
              <DonutChart data={statusDonutRows} centerLabel="Total Transactions" formatValue={(v) => String(v)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <div className="card">
              <div className="toolbar" style={{ marginBottom: 4 }}>
                <h3 style={{ margin: 0 }}>Recent Transactions</h3>
                <Link href="/expenses">View All</Link>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Expense No.</th>
                    <th>Date</th>
                    <th>Sales/POD</th>
                    <th>Agency &amp; PIC</th>
                    <th>Advertiser &amp; PIC</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/expenses/${r.id}`}>{r.expenseNo}</Link>
                      </td>
                      <td>{formatDate(r.expenseDate)}</td>
                      <td>
                        {r.salesName}
                        {r.departmentName !== '-' && <span style={{ color: 'var(--muted)' }}> / {r.departmentName}</span>}
                      </td>
                      <td>
                        {r.agencyName}
                        {r.agencyName !== '-' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.salesName}</div>}
                      </td>
                      <td>
                        {r.advertiserName}
                        {r.advertiserName !== '-' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.salesName}</div>}
                      </td>
                      <td>{r.categoryNames}</td>
                      <td>{formatCurrency(Number(r.amount))}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                  {recentTransactions.length === 0 && (
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
