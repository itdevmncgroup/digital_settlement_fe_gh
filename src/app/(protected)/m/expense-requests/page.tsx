'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import WebMobileGate from '@/components/WebMobileGate';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import {
  clientLabel,
  currentApprovalStep,
  EXPENSE_REQUEST_STATUS_LABEL,
  expenseRequestTone,
  ExpenseRequest,
} from '@/lib/expenseRequests';
import { SkeletonList, TONE_COLOR, toneStyle } from '@/lib/mobileUi';

// Expense Requests (Karangan Bunga). With webmobile.request.expense.read.owndept: those of the
// logged-in user's Department(s), plus any outside them where the user is one of its approvers,
// so nothing they must act on is hidden. With only .read.own: just the ones they requested.
// Tap a row for the detail (and Approve/Reject when it's the user's turn).
export default function MobileExpenseRequestsPage() {
  return (
    <WebMobileGate permissions={['webmobile.request.expense.read.own', 'webmobile.request.expense.read.owndept']}>
      <MobileExpenseRequestsList />
    </WebMobileGate>
  );
}

function MobileExpenseRequestsList() {
  const { user, hasRole, hasPermission } = useAuth();
  const [rows, setRows] = useState<ExpenseRequest[] | null>(null);
  const [departmentIds, setDepartmentIds] = useState<Set<string> | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .get<ExpenseRequest[]>('/expense-requests')
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api
      .get<{ id: string }[]>('/departments/me')
      .then((ds) => setDepartmentIds(new Set(ds.map((d) => d.id))))
      .catch(() => setDepartmentIds(new Set()));
  }, []);

  const isAdmin = hasRole('ADMINISTRATOR');
  const seeDept = isAdmin || hasPermission('webmobile.request.expense.read.owndept');
  const inScope = (r: ExpenseRequest) =>
    isAdmin ||
    (seeDept
      ? (!!r.department && !!departmentIds?.has(r.department.id)) ||
        !!r.approvalRequest?.steps.some((s) => s.resolvedApprover?.id === user?.id)
      : r.requestedBy?.id === user?.id || r.createdBy?.id === user?.id);

  const q = search.trim().toLowerCase();
  const shown = (rows ?? [])
    .filter(inScope)
    .filter((r) => !status || r.status === status)
    .filter(
      (r) =>
        !q ||
        [r.requestNo, r.requestedBy?.name, clientLabel(r), r.brands?.map((b) => b.brand.name).join(' '), r.agencies?.map((a) => a.agency.name).join(' '), r.greetingText, r.recipientAddress].some((v) => v?.toLowerCase().includes(q)),
    );

  const ready = rows && departmentIds;

  return (
    <div>
      <h1>Request Expense</h1>
      <div className="m-filters">
        <div className="m-search">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search request no, client..." />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(EXPENSE_REQUEST_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-text">{error}</div>}
      {!ready && !error && <SkeletonList />}
      {ready && shown.length === 0 && <div className="m-empty">No expense requests found.</div>}
      {ready && shown.length > 0 && (
        <div className="m-subtitle" style={{ margin: '0 2px 10px' }}>
          {shown.length} request(s)
        </div>
      )}

      {ready &&
        shown.map((r) => {
          const step = currentApprovalStep(r);
          const myTurn = !!step && (step.resolvedApprover?.id === user?.id || isAdmin);
          const tone = expenseRequestTone(r.status);
          return (
            <Link key={r.id} href={`/m/expense-requests/${r.id}`} className="m-item" style={toneStyle(TONE_COLOR[tone])}>
              <div className="m-item-row">
                <span className="m-item-title">{r.requestNo}</span>
                <span className="m-item-amount">{r.activityType?.name}</span>
              </div>
              <div className="m-item-meta">
                {clientLabel(r)} · {formatDate(r.sendDate)}
                <br />
                {r.requestedBy?.name}
                {r.department && ` · ${r.department.name}`}
              </div>
              <div className="m-item-foot">
                <span className={`badge badge-${tone}`}>{EXPENSE_REQUEST_STATUS_LABEL[r.status]}</span>
                {step && <span>Waiting: {step.position.name}</span>}
                {myTurn && <span style={{ marginLeft: 'auto', color: 'var(--warning)' }}>Needs your approval ›</span>}
              </div>
            </Link>
          );
        })}
    </div>
  );
}
