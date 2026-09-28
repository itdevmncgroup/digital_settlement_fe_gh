'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import SplashLoader from '@/components/SplashLoader';
import { useAuth } from '@/lib/auth';
import { positionMatches } from '@/lib/position';
import { formatDate } from '@/lib/date';
import {
  formatCompactCurrency,
  formatCurrency,
  SkeletonList,
  StatTile,
  StatusBadge,
  statusTone,
  TONE_COLOR,
  toneStyle,
} from '@/lib/mobileUi';

interface Bucket {
  count: number;
  totalAmount: string | number;
}

interface ExpenseSummaryRow {
  id: string;
  expenseNo: string;
  amount: string;
  status: string;
  expenseDate: string;
  salesId: string;
  advertiser: { name: string } | null;
  brand: { name: string } | null;
}

interface SalesDashboard {
  month: Bucket;
  pending: Bucket;
  fullyApproved: Bucket;
  needsRevisionCount: number;
  recent: ExpenseSummaryRow[];
}

// Own expenses (any status) open the mobile Expense form - same look as New
// Expense, read-only once past DRAFT (see ExpenseForm's `readOnly`). Someone
// else's Expense (GenericDashboard's recent list can include non-owned rows
// for back-office/Sales Admin roles) keeps opening the general detail page.
function expenseHref(r: ExpenseSummaryRow, viewerId: string | undefined) {
  return r.salesId === viewerId ? `/m/expense/${r.id}/edit` : `/expenses/${r.id}`;
}

function RecentList({ rows, viewerId }: { rows: ExpenseSummaryRow[]; viewerId: string | undefined }) {
  if (rows.length === 0) return <div className="m-empty">No expenses yet.</div>;
  return (
    <>
      {rows.map((r) => (
        <Link key={r.id} href={expenseHref(r, viewerId)} className="m-item" style={toneStyle(TONE_COLOR[statusTone(r.status)])}>
          <div className="m-item-row">
            <span className="m-item-title">{r.expenseNo}</span>
            <span className="m-item-amount">{formatCurrency(r.amount)}</span>
          </div>
          <div className="m-item-meta">
            {r.advertiser?.name ?? '-'} / {r.brand?.name ?? '-'} · {formatDate(r.expenseDate)}
          </div>
          <StatusBadge status={r.status} />
        </Link>
      ))}
    </>
  );
}

export default function MobileDashboardPage() {
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const positionCode = user?.position?.code;
  const ownDashboard =
    positionMatches(positionCode, 'HEAD_POD')
      ? '/m/dashboard-head-dept'
      : positionMatches(positionCode, 'CO-CSO')
      ? '/m/dashboard-co-cso'
      : user?.roles.includes('MANAGEMENT')
      ? '/m/dashboard-management'
      : null;
  useEffect(() => {
    if (ownDashboard) router.replace(ownDashboard);
  }, [ownDashboard, router]);
  if (ownDashboard) return <SplashLoader message="Opening your dashboard" />;
  if (user && !hasPermission('dashboard-sales.read.own')) return <GenericDashboard />;
  return <SalesDashboardView />;
}

function SalesDashboardView() {
  const { user } = useAuth();
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<SalesDashboard>('/dashboard/sales')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
  }, []);

  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div>
      <h1>Hi, {user?.name?.split(' ')[0]} 👋</h1>
      <div className="m-subtitle">Your expenses · {monthLabel}</div>

      {error && <div className="error-text">{error}</div>}
      {!data && !error && <SkeletonList />}

      {data && (
        <>
          <div className="m-hero">
            <div className="m-hero-label">Created in {monthLabel}</div>
            <div className="m-hero-value">{formatCompactCurrency(data.month.totalAmount)}</div>
            <div className="m-hero-sub">{data.month.count} expense(s)</div>
          </div>

          <div className="m-stat-grid">
            <StatTile
              label="Pending approval"
              value={data.pending.count}
              icon="clock"
              tone="var(--warning)"
              sub={formatCompactCurrency(data.pending.totalAmount)}
            />
            <StatTile
              label="Fully approved"
              value={data.fullyApproved.count}
              icon="check-circle"
              tone="var(--success)"
              sub={formatCompactCurrency(data.fullyApproved.totalAmount)}
            />
            {data.needsRevisionCount > 0 && (
              <StatTile
                wide
                label="Needs attention"
                value={data.needsRevisionCount}
                icon="alert"
                tone="var(--danger)"
                sub="Rejected or need revision"
                href="/m/expenses"
              />
            )}
          </div>

          <div className="m-section-title">Latest expenses</div>
          <RecentList rows={data.recent} viewerId={user?.id} />
        </>
      )}
    </div>
  );
}

// Roles without a dedicated dashboard: what they act on - pending approvals plus
// the last 30 days of expenses the API lets them see.
function GenericDashboard() {
  const { user } = useAuth();
  const [pending, setPending] = useState<number | null>(null);
  const [expenses, setExpenses] = useState<ExpenseSummaryRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const from = d.toISOString().slice(0, 10);
    api.get<unknown[]>('/approvals/pending').then((r) => setPending(r.length)).catch(() => setPending(0));
    api
      .get<ExpenseSummaryRow[]>(`/expenses?fromDate=${from}`)
      .then(setExpenses)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
  }, []);

  const total = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div>
      <h1>Hi, {user?.name?.split(' ')[0]} 👋</h1>
      <div className="m-subtitle">Last 30 days</div>
      {error && <div className="error-text">{error}</div>}
      {!expenses && !error && <SkeletonList />}
      {expenses && (
        <>
          <div className="m-hero">
            <div className="m-hero-label">Expenses</div>
            <div className="m-hero-value">{formatCompactCurrency(total)}</div>
            <div className="m-hero-sub">{expenses.length} expense(s)</div>
          </div>
          <div className="m-stat-grid">
            <StatTile
              wide
              label="Waiting your approval"
              value={pending ?? 0}
              icon="clock"
              tone="var(--warning)"
              href="/m/approvals"
            />
          </div>
          <div className="m-section-title">Latest expenses</div>
          <RecentList rows={expenses.slice(0, 5)} viewerId={user?.id} />
        </>
      )}
    </div>
  );
}
