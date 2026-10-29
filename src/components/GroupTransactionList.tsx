'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/date';

interface GroupTransaction {
  id: string;
  expenseNo: string;
  expenseDate: string;
  purpose: string;
  amount: number;
  status: string;
  salesName: string | null;
  departmentName: string | null;
  advertiserName: string | null;
  brandName: string | null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

// Transactions counted under one Agency / Advertiser on the Expense dashboard (same period / POD /
// status filters as the Top-5 card). `query` is the dashboard's already-built query string.
export default function GroupTransactionList({ group, id, query }: { group: 'agency' | 'advertiser'; id: string; query: string }) {
  const [rows, setRows] = useState<GroupTransaction[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError('');
    api
      .get<GroupTransaction[]>(`/dashboard/expense-by-${group}/${id}/transactions${query}`)
      .then((data) => !cancelled && setRows(data))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Failed to load transactions'));
    return () => {
      cancelled = true;
    };
  }, [group, id, query]);

  if (error) return <div className="error-text">{error}</div>;
  if (!rows) return <div style={{ color: 'var(--muted)' }}>Loading...</div>;
  if (rows.length === 0) return <div style={{ color: 'var(--muted)' }}>No transactions</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Expense No</th>
            <th>Date</th>
            <th>POD</th>
            <th>Requestor</th>
            <th>Advertiser</th>
            <th>Brand</th>
            <th>Purpose</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.expenseNo}</td>
              <td>{formatDate(r.expenseDate)}</td>
              <td>{r.departmentName ?? '-'}</td>
              <td>{r.salesName ?? '-'}</td>
              <td>{r.advertiserName ?? '-'}</td>
              <td>{r.brandName ?? '-'}</td>
              <td>{r.purpose}</td>
              <td>{r.status.replace(/_/g, ' ')}</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
