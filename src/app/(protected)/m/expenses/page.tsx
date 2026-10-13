'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  // Set when keyed in on someone else's behalf (the inputter).
  createdById?: string | null;
  sales: { name: string };
  advertiser: { name: string } | null;
  brand: { name: string } | null;
}

// Own expenses (any status) open the mobile Expense form - same look as New
// Expense, read-only once past DRAFT (see ExpenseForm's `readOnly`). Anything
// not owned by the viewer (Sales Admin / back office browsing others' Expenses)
// keeps opening the general expense detail page.
function expenseHref(r: ExpenseRow, viewerId: string | undefined) {
  if (r.salesId === viewerId) return `/m/expense/${r.id}/edit`;
  return `/expenses/${r.id}`;
}

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export default function MobileExpensesPage() {
  return (
    <WebMobileGate permissions={['webmobile.expense.read.own', 'webmobile.expense.read.owndept']}>
      <MobileExpensesList />
    </WebMobileGate>
  );
}

function MobileExpensesList() {
  const { user, hasRole, hasPermission } = useAuth();
  // webmobile.expense.read.owndept shows every row the API returns (its Department scope is
  // enforced there); with only .read.own the list narrows to Expenses the user owns or keyed in.
  const seeDept = hasRole('ADMINISTRATOR') || hasPermission('webmobile.expense.read.owndept');
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [days, setDays] = useState('30');

  useEffect(() => {
    const params = new URLSearchParams({ status: 'ALL', fromDate: isoDaysAgo(Number(days)) });
    if (search) params.set('search', search);
    setRows(null);
    setError('');
    api
      .get<ExpenseRow[]>(`/expenses?${params}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [search, days]);

  const statuses = Array.from(new Set((rows ?? []).map((r) => r.status))).sort();
  const shown = (rows ?? [])
    .filter((r) => seeDept || r.salesId === user?.id || r.createdById === user?.id)
    .filter((r) => !status || r.status === status);
  const total = shown.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div>
      <h1>Expenses</h1>
      <div className="m-filters">
        <form
          className="m-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search expense no, purpose..."
          />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-text">{error}</div>}
      {!rows && !error && <SkeletonList />}
      {rows && shown.length === 0 && <div className="m-empty">No expenses found.</div>}
      {rows && shown.length > 0 && (
        <div className="m-subtitle" style={{ margin: '0 2px 10px' }}>
          {shown.length} expense(s) · {formatCurrency(total)}
        </div>
      )}

      {shown.map((r) => (
        <Link key={r.id} href={expenseHref(r, user?.id)} className="m-item" style={toneStyle(TONE_COLOR[statusTone(r.status)])}>
          <div className="m-item-row">
            <span className="m-item-title">{r.expenseNo}</span>
            <span className="m-item-amount">{formatCurrency(r.amount)}</span>
          </div>
          <div className="m-item-meta">
            {r.advertiser?.name ?? '-'} / {r.brand?.name ?? '-'} · {formatDate(r.expenseDate)}
            <br />
            {r.sales?.name}
            {r.purpose ? ` · ${r.purpose}` : ''}
          </div>
          <StatusBadge status={r.status} />
        </Link>
      ))}
    </div>
  );
}
