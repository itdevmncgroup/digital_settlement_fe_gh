'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCompactCurrency, formatCurrency, SkeletonList, StatTile } from '@/lib/mobileUi';

interface Bucket {
  count: number;
  totalAmount: string | number;
}

interface ApproverDashboard {
  departments: { id: string; name: string }[];
  allDepartments?: boolean;
  notComplete: Bucket;
  complete: Bucket;
  pendingApprovalCount: number;
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

// Shared by the Head Dept / CO-CSO / Management dashboards - same numbers,
// different endpoint (each scoped server-side to the caller's Department(s)).
export default function ApproverDashboardView({ title, endpoint }: { title: string; endpoint: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<ApproverDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<ApproverDashboard>(endpoint)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
  }, [endpoint]);

  const scope = !data
    ? user?.name
    : data.allDepartments
    ? 'All departments'
    : data.departments.map((d) => d.name).join(', ') || 'No department';

  return (
    <div>
      <h1>{title}</h1>
      <div className="m-subtitle">{scope}</div>

      {error && <div className="error-text">{error}</div>}
      {!data && !error && <SkeletonList />}

      {data && (
        <>
          <HeroCard count={data.pendingApprovalCount} />

          <div className="m-section-title">In progress</div>
          <div className="m-stat-grid">
            <StatTile label="Transactions" value={data.notComplete.count} icon="layers" tone="var(--warning)" sub="Not complete" />
            <StatTile
              label="Total amount"
              value={formatCompactCurrency(data.notComplete.totalAmount)}
              icon="clock"
              tone="var(--warning)"
              sub={formatCurrency(data.notComplete.totalAmount)}
            />
          </div>

          <div className="m-section-title">Complete</div>
          <div className="m-stat-grid">
            <StatTile label="Transactions" value={data.complete.count} icon="check-circle" tone="var(--success)" sub="Complete" />
            <StatTile
              label="Total amount"
              value={formatCompactCurrency(data.complete.totalAmount)}
              icon="settlement"
              tone="var(--success)"
              sub={formatCurrency(data.complete.totalAmount)}
            />
          </div>
        </>
      )}
    </div>
  );
}
