'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import SplashLoader from '@/components/SplashLoader';
import DepartmentTotalsCard, { DepartmentTotal } from '@/components/DepartmentTotalsCard';
import WebMobileGate from '@/components/WebMobileGate';
import { useAuth } from '@/lib/auth';
import { positionMatches } from '@/lib/position';
import { formatDate } from '@/lib/date';
import { currentApprovalStep, ExpenseRequest, POSITION_CORSEC, POSITION_SALES_CS } from '@/lib/expenseRequests';
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
  total: Bucket;
  pending: Bucket;
  complete: Bucket;
  needsRevisionCount: number;
  recent: ExpenseSummaryRow[];
  // One row per Department of the user - only sent when they belong to more than one.
  byDepartment?: DepartmentTotal[];
}

// Own expenses (any status) open the mobile Expense form - same look as New
// Expense, read-only once past DRAFT (see ExpenseForm's `readOnly`). Someone
// else's Expense (the recent list can include non-owned rows
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
  const { user, hasRole, hasPermission } = useAuth();
  const router = useRouter();
  const positionCode = user?.position?.code;
  // Every web mobile dashboard needs webmobile.dashboard.read.own/.owndept - without it the
  // user stays here and WebMobileGate shows "no access" instead of bouncing to a gated page.
  const canDashboard = hasRole('ADMINISTRATOR') || hasPermission('webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept');
  const ownDashboard = !canDashboard
    ? null
    : positionMatches(positionCode, 'HEAD-POD')
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
  return (
    <WebMobileGate permissions={['webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept']}>
      <SalesDashboardView />
    </WebMobileGate>
  );
}

const RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last year' },
];

// Documents waiting on the logged-in user right now - same rule as /m/approvals:
// GET /approvals/pending also returns look-ahead rows (isMyTurn false), and
// Expense Requests are a separate flow GET /expense-requests supplies.
// Also counts Expense Requests waiting on the user's Position: Sales Customer
// Service (budget input) and Corsec (verification). null until loaded.
// `href` is /m/approvals: it lists everything waiting on the user, budget-stage
// Expense Requests included (tap one to fill in the budget).
function usePendingApprovalCount(): { count: number; href: string } | null {
  const { user, hasRole } = useAuth();
  const [result, setResult] = useState<{ count: number; href: string } | null>(null);
  const userId = user?.id;
  const positionCode = user?.position?.code;
  const isAdmin = hasRole('ADMINISTRATOR');

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      api.get<{ isMyTurn?: boolean }[]>('/approvals/pending').catch(() => []),
      api.get<ExpenseRequest[]>('/expense-requests').catch(() => [] as ExpenseRequest[]),
    ]).then(([rows, requests]) => {
      const mine = requests.filter((q) => {
        if (q.status === 'BUDGET_INPUT') return positionCode === POSITION_SALES_CS || isAdmin;
        if (q.status === 'CORSEC_VERIFICATION') return positionCode === POSITION_CORSEC || isAdmin;
        const step = currentApprovalStep(q);
        return !!step && (step.resolvedApprover?.id === userId || isAdmin);
      });
      setResult({ count: rows.filter((r) => r.isMyTurn || isAdmin).length + mine.length, href: '/m/approvals' });
    });
  }, [userId, positionCode, isAdmin]);

  return result;
}

function SalesDashboardView() {
  const { user, hasPermission } = useAuth();
  const waitingApproval = usePendingApprovalCount();
  const [range, setRange] = useState('30d');
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api
      .get<SalesDashboard>(`/dashboard/sales?range=${range}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
  }, [range]);

  const listHref = (bucket: string) => `/m/dashboard/expenses?bucket=${bucket}&range=${range}`;
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';

  return (
    <div>
      <h1>Hi, {user?.name?.split(' ')[0]} 👋</h1>
      <div className="m-subtitle">{hasPermission('webmobile.dashboard.read.owndept') ? 'Your department expenses' : 'Your expenses'}</div>
      <div className="m-filters">
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Period">
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-text">{error}</div>}
      {!data && !error && <SkeletonList />}

      {data && (
        <>
          <div className="m-hero">
            <div className="m-hero-label">Created · {rangeLabel}</div>
            <div className="m-hero-value">{formatCompactCurrency(data.total.totalAmount)}</div>
            <div className="m-hero-sub">{data.total.count} expense(s)</div>
          </div>

          <div className="m-stat-grid">
            {!!waitingApproval?.count && (
              <StatTile
                wide
                label="Waiting approval"
                value={waitingApproval.count}
                icon="clock"
                tone="var(--warning)"
                sub="Document(s) need your approval"
                href={waitingApproval.href}
              />
            )}
            <StatTile
              label="Total pending"
              value={formatCompactCurrency(data.pending.totalAmount)}
              icon="clock"
              tone="var(--warning)"
              sub="Not sent to Odoo"
              href={listHref('pending')}
            />
            <StatTile
              label="Total complete"
              value={formatCompactCurrency(data.complete.totalAmount)}
              icon="check-circle"
              tone="var(--success)"
              sub="Sent to Odoo"
              href={listHref('complete')}
            />
            <StatTile
              label="Pending approval"
              value={data.pending.count}
              icon="clock"
              tone="var(--warning)"
              sub="Expense(s)"
              href={listHref('pending')}
            />
            <StatTile
              label="Complete approval"
              value={data.complete.count}
              icon="check-circle"
              tone="var(--success)"
              sub="Expense(s)"
              href={listHref('complete')}
            />
            {data.needsRevisionCount > 0 && (
              <StatTile
                wide
                label="Needs attention"
                value={data.needsRevisionCount}
                icon="alert"
                tone="var(--danger)"
                sub="Rejected or need revision"
                href={listHref('attention')}
              />
            )}
          </div>

          <DepartmentTotalsCard data={data.byDepartment} title={`Expense per department · ${rangeLabel}`} />

          <div className="m-section-title">Latest expenses</div>
          <RecentList rows={data.recent} viewerId={user?.id} />
        </>
      )}
    </div>
  );
}
