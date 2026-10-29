'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import WebMobileGate from '@/components/WebMobileGate';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import { formatCurrency, SkeletonList, StatusBadge, statusTone, TONE_COLOR, toneStyle } from '@/lib/mobileUi';

interface ExpenseRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  purpose: string;
  amount: string;
  status: string;
  salesId: string;
  department?: { name: string } | null;
  advertiser: { name: string } | null;
  brand: { name: string } | null;
}

const BUCKET_TITLES: Record<string, string> = {
  pending: 'Pending approval',
  complete: 'Complete approval',
  attention: 'Needs attention',
};

// Head Dept / CO-CSO tiles (?kind=head-pod|co-cso) count by Odoo state instead of approval.
const DEPARTMENT_BUCKET_TITLES: Record<string, string> = {
  pending: 'Pending - not sent to Odoo',
  complete: 'Complete - sent to Odoo',
  // Management tiles (?kind=management) split by expense status.
  'in-progress': 'In progress',
};

const RANGE_LABELS: Record<string, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
};

// Drill-down behind the Sales dashboard tiles - the list API uses the same
// filter as the tile's own count, so the rows always add up to the tile.
function DashboardExpenseList() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const bucket = params.get('bucket') ?? 'pending';
  const range = params.get('range') ?? '30d';
  const kind = params.get('kind');
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    const path =
      kind === 'management'
        ? `/dashboard/management/expenses?bucket=${encodeURIComponent(bucket)}`
        : kind
          ? `/dashboard/department/expenses?kind=${encodeURIComponent(kind)}&bucket=${encodeURIComponent(bucket)}`
          : `/dashboard/sales/expenses?bucket=${encodeURIComponent(bucket)}&range=${encodeURIComponent(range)}`;
    api
      .get<ExpenseRow[]>(path)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [bucket, range, kind]);

  const total = (rows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div>
      <button className="btn" type="button" onClick={() => router.push('/m/dashboard')}>
        ← Dashboard
      </button>
      <h1>{(kind ? DEPARTMENT_BUCKET_TITLES : BUCKET_TITLES)[bucket] ?? 'Expenses'}</h1>
      <div className="m-subtitle">{kind ? 'Department expenses' : RANGE_LABELS[range] ?? RANGE_LABELS['30d']}</div>

      {error && <div className="error-text">{error}</div>}
      {!rows && !error && <SkeletonList />}
      {rows && rows.length === 0 && <div className="m-empty">No expenses found.</div>}
      {rows && rows.length > 0 && (
        <div className="m-subtitle" style={{ margin: '0 2px 10px' }}>
          {rows.length} expense(s) · {formatCurrency(total)}
        </div>
      )}

      {(rows ?? []).map((r) => (
        <Link
          key={r.id}
          href={r.salesId === user?.id ? `/m/expense/${r.id}/edit` : `/m/expenses/${r.id}`}
          className="m-item"
          style={toneStyle(TONE_COLOR[statusTone(r.status)])}
        >
          <div className="m-item-row">
            <span className="m-item-title">{r.expenseNo}</span>
            <span className="m-item-amount">{formatCurrency(r.amount)}</span>
          </div>
          <div className="m-item-meta">
            {r.department?.name ? `${r.department.name} · ` : ''}
            {r.advertiser?.name ?? '-'} / {r.brand?.name ?? '-'} · {formatDate(r.expenseDate)}
            {r.purpose ? ` · ${r.purpose}` : ''}
          </div>
          <StatusBadge status={r.status} />
        </Link>
      ))}
    </div>
  );
}

export default function MobileDashboardExpensesPage() {
  return (
    <WebMobileGate permissions={['webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept']}>
      <Suspense fallback={<SkeletonList />}>
        <DashboardExpenseList />
      </Suspense>
    </WebMobileGate>
  );
}
