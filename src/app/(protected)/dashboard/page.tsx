'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import DatePicker from '@/components/DatePicker';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import DepartmentExpenseChart from '@/components/DepartmentExpenseChart';

interface Summary {
  totalExpense: number;
  totalTransaction: number;
  averageExpense: number;
  approved: number;
  pending: number;
  rejected: number;
  draft: number;
}

interface GroupRow {
  id: string;
  name: string;
  totalExpense: number;
  transactionCount: number;
}

interface DepartmentRow {
  id: string;
  name: string;
  totalExpense: number;
  transactionCount: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function buildQuery(from: string, to: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export default function DashboardPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [byUnit, setByUnit] = useState<GroupRow[]>([]);
  const [byAdvertiser, setByAdvertiser] = useState<GroupRow[]>([]);
  const [byDepartment, setByDepartment] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const unitPagination = usePagination(byUnit);
  const advertiserPagination = usePagination(byAdvertiser);
  const departmentPagination = usePagination(byDepartment);

  useEffect(() => {
    const qs = buildQuery(from, to);
    setLoading(true);
    Promise.all([
      api.get<Summary>(`/dashboard/summary${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-unit${qs}`),
      api.get<GroupRow[]>(`/dashboard/expense-by-advertiser${qs}`),
      api.get<DepartmentRow[]>(`/dashboard/expense-by-department${qs}`),
    ])
      .then(([s, u, c, p]) => {
        setSummary(s);
        setByUnit(u);
        setByAdvertiser(c);
        setByDepartment(p);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [from, to]);

  const clearRange = () => {
    setFrom('');
    setTo('');
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Dashboard</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <DatePicker value={from} onChange={setFrom} style={{ width: 150 }} />
          <span style={{ color: 'var(--muted)' }}>to</span>
          <DatePicker value={to} onChange={setTo} style={{ width: 150 }} />
          {(from || to) && (
            <button className="btn" onClick={clearRange}>
              Clear
            </button>
          )}
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
            </div>
            <div className="stat">
              <div className="label">Transactions</div>
              <div className="value">{summary.totalTransaction}</div>
            </div>
            <div className="stat">
              <div className="label">Average Expense</div>
              <div className="value">{formatCurrency(Number(summary.averageExpense))}</div>
            </div>
            <div className="stat">
              <div className="label">Approved</div>
              <div className="value" style={{ color: 'var(--success)' }}>{summary.approved}</div>
            </div>
            <div className="stat">
              <div className="label">Pending</div>
              <div className="value" style={{ color: 'var(--warning)' }}>{summary.pending}</div>
            </div>
            <div className="stat">
              <div className="label">Rejected</div>
              <div className="value" style={{ color: 'var(--danger)' }}>{summary.rejected}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <h3>Expense by Unit</h3>
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Transactions</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {unitPagination.pageRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.transactionCount}</td>
                      <td>{formatCurrency(Number(row.totalExpense))}</td>
                    </tr>
                  ))}
                  {byUnit.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--muted)' }}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {byUnit.length > 0 && (
                <Pagination
                  page={unitPagination.page}
                  totalPages={unitPagination.totalPages}
                  pageSize={unitPagination.pageSize}
                  onPageChange={unitPagination.setPage}
                  onPageSizeChange={unitPagination.setPageSize}
                  total={unitPagination.total}
                  rangeStart={unitPagination.rangeStart}
                  rangeEnd={unitPagination.rangeEnd}
                />
              )}
            </div>

            <div className="card">
              <h3>Expense by Advertiser</h3>
              <table>
                <thead>
                  <tr>
                    <th>Advertiser</th>
                    <th>Transactions</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {advertiserPagination.pageRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.transactionCount}</td>
                      <td>{formatCurrency(Number(row.totalExpense))}</td>
                    </tr>
                  ))}
                  {byAdvertiser.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--muted)' }}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {byAdvertiser.length > 0 && (
                <Pagination
                  page={advertiserPagination.page}
                  totalPages={advertiserPagination.totalPages}
                  pageSize={advertiserPagination.pageSize}
                  onPageChange={advertiserPagination.setPage}
                  onPageSizeChange={advertiserPagination.setPageSize}
                  total={advertiserPagination.total}
                  rangeStart={advertiserPagination.rangeStart}
                  rangeEnd={advertiserPagination.rangeEnd}
                />
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16 }}>
            <div className="card">
              <h3>Total Expense by Department</h3>
              <p style={{ color: 'var(--muted)', marginTop: -8, marginBottom: 18, fontSize: 12 }}>
                Department = an org department and/or a named coverage group for one or more Sales, containing multiple Agency→Brand pairs.
              </p>
              <DepartmentExpenseChart data={byDepartment} />
            </div>

            <div className="card">
              <h3>Expense by Department</h3>
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Transactions</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentPagination.pageRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.transactionCount}</td>
                      <td>{formatCurrency(Number(row.totalExpense))}</td>
                    </tr>
                  ))}
                  {byDepartment.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--muted)' }}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {byDepartment.length > 0 && (
                <Pagination
                  page={departmentPagination.page}
                  totalPages={departmentPagination.totalPages}
                  pageSize={departmentPagination.pageSize}
                  onPageChange={departmentPagination.setPage}
                  onPageSizeChange={departmentPagination.setPageSize}
                  total={departmentPagination.total}
                  rangeStart={departmentPagination.rangeStart}
                  rangeEnd={departmentPagination.rangeEnd}
                />
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
