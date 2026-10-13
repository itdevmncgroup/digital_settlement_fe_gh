'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import RankedBarList from '@/components/RankedBarList';
import DepartmentTotalsCard, { DepartmentTotal } from '@/components/DepartmentTotalsCard';
import { formatCompactCurrency, formatCurrency, SkeletonList, StatTile } from '@/lib/mobileUi';

interface Bucket {
  count: number;
  totalAmount: string | number;
}

interface OdooDepartmentDashboard {
  departments: { id: string; name: string }[];
  pendingApprovalCount: number;
  odooPending: Bucket;
  odooComplete: Bucket;
  topSales?: TopRow[];
  topDepartments?: TopRow[];
  byDepartment?: DepartmentTotal[];
}

interface TopRow {
  id: string;
  name: string;
  count: number;
  totalAmount: string | number;
}

// Only tappable when something actually waits on this user.
function HeroCard({ count }: { count: number }) {
  const body = (
    <>
      <div className="m-hero-label">Waiting your approval</div>
      <div className="m-hero-value">{count}</div>
      <div className="m-hero-sub">{count === 0 ? 'All caught up' : 'Tap to review'}</div>
    </>
  );
  return count > 0 ? (
    <Link href="/m/approvals" className="m-hero" style={{ display: 'block', color: '#fff', textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    <div className="m-hero">{body}</div>
  );
}

// Shared by Head Dept / CO-CSO. "Pending" = Department expenses not sent to Odoo
// yet, "Complete" = their Settlement already sent to Odoo. The endpoint decides
// which top-10 list it returns (topSales or topDepartments).
export default function DepartmentOdooDashboardView({
  title,
  endpoint,
  chartTitle,
}: {
  title: string;
  endpoint: string;
  chartTitle: string;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<OdooDepartmentDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<OdooDepartmentDashboard>(endpoint)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
  }, [endpoint]);

  const topRows = data?.topSales ?? data?.topDepartments ?? [];
  // '/dashboard/head-pod' -> 'head-pod' / '/dashboard/co-cso' -> 'co-cso': which approver's
  // Departments the drill-down list should cover.
  const listHref = (bucket: 'pending' | 'complete') =>
    `/m/dashboard/expenses?kind=${encodeURIComponent(endpoint.split('/').pop() ?? '')}&bucket=${bucket}`;
  const scope = !data ? user?.name : data.departments.map((d) => d.name).join(', ') || 'No department';

  return (
    <div>
      <h1>{title}</h1>
      <div className="m-subtitle">{scope}</div>

      {error && <div className="error-text">{error}</div>}
      {!data && !error && <SkeletonList />}

      {data && (
        <>
          <HeroCard count={data.pendingApprovalCount} />

          <div className="m-section-title">Department expenses</div>
          <div className="m-stat-grid">
            <StatTile
              label="Pending"
              value={data.odooPending.count}
              icon="clock"
              tone="var(--warning)"
              sub="Not sent to Odoo"
              href={listHref('pending')}
            />
            <StatTile
              label="Complete"
              value={data.odooComplete.count}
              icon="check-circle"
              tone="var(--success)"
              sub="Sent to Odoo"
              href={listHref('complete')}
            />
            <StatTile
              label="Pending amount"
              value={formatCompactCurrency(data.odooPending.totalAmount)}
              icon="layers"
              tone="var(--warning)"
              sub={formatCurrency(data.odooPending.totalAmount)}
              href={listHref('pending')}
            />
            <StatTile
              label="Complete amount"
              value={formatCompactCurrency(data.odooComplete.totalAmount)}
              icon="settlement"
              tone="var(--success)"
              sub={formatCurrency(data.odooComplete.totalAmount)}
              href={listHref('complete')}
            />
          </div>

          <DepartmentTotalsCard data={data.byDepartment} />

          <div className="m-section-title">{chartTitle}</div>
          <div className="m-item" style={{ display: 'block' }}>
            <RankedBarList
              data={topRows.map((s) => ({
                id: s.id,
                name: s.name,
                value: Number(s.totalAmount),
                color: 'var(--primary)',
                displayValue: `${formatCompactCurrency(s.totalAmount)} · ${s.count}`,
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}
