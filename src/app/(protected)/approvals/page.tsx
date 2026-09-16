'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import DatePicker from '@/components/DatePicker';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface DepartmentOption {
  id: string;
  name: string;
}

interface DocSummary {
  id: string;
  expenseNo?: string;
  eventNo?: string;
  amount?: string;
  estimatedAmount?: string;
  expenseDate?: string;
  date?: string;
  sales: { name: string };
  unit: { name: string };
  department?: { id: string; name: string } | null;
  advertiser: { name: string };
  brand: { name: string };
}

interface StepInfo {
  stepOrder: number;
  position: { name: string };
  resolvedApprover?: { id: string; name: string };
}

interface PendingApproval {
  id: string;
  documentStage: 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT';
  currentStep: number;
  steps: StepInfo[];
  expense: DocSummary | null;
  event: DocSummary | null;
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

const defaultFromDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};
const defaultToDate = () => new Date().toISOString().slice(0, 10);

export default function ApprovalsPage() {
  const { user, hasRole } = useAuth();
  const canActOnBehalf = hasRole('ADMIN', 'FINANCE');

  const [rows, setRows] = useState<PendingApproval[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [departmentFilter, setDepartmentFilter] = useState('');
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);

  const load = () => {
    const params = new URLSearchParams();
    if (departmentFilter) params.set('departmentId', departmentFilter);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    const qs = params.toString();
    api
      .get<PendingApproval[]>(`/approvals/pending${qs ? `?${qs}` : ''}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, [departmentFilter, fromDate, toDate]);

  useEffect(() => {
    const path = canActOnBehalf ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canActOnBehalf]);

  const filteredRows = rows.filter((r) => {
    if (!search) return true;
    const doc = r.expense ?? r.event;
    if (!doc) return false;
    const q = search.toLowerCase();
    const docNo = r.expense ? doc.expenseNo : doc.eventNo;
    return [docNo, doc.sales?.name, doc.unit?.name, doc.advertiser?.name, doc.brand?.name].some((v) =>
      v?.toLowerCase().includes(q),
    );
  });
  const pagination = usePagination(filteredRows);

  // Deliberately narrower than the Expense detail page's canAct: only the step's
  // actual resolvedApprover (or an ADMIN override) gets a button here, so it
  // disappears the moment they act and only reappears for whoever the *next*
  // step resolves to - an expense.approve.all/owndept holder can still act via
  // the Expense detail page (backend's assertApprovalOverride still allows it),
  // it just isn't surfaced as a button on every department-wide pending row in this list.
  const canActOn = (step: StepInfo | undefined) => !!step && (step.resolvedApprover?.id === user?.id || hasRole('ADMIN'));

  const approve = async (r: PendingApproval) => {
    setBusyId(r.id);
    setError('');
    try {
      const kind = r.expense ? 'expense' : 'event';
      const docId = (r.expense ?? r.event)!.id;
      await api.post(`/approvals/${kind}/${docId}/approve`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setBusyId('');
    }
  };

  const reject = async (r: PendingApproval) => {
    const reason = window.prompt('Reject reason:');
    if (!reason) return;
    setBusyId(r.id);
    setError('');
    try {
      const kind = r.expense ? 'expense' : 'event';
      const docId = (r.expense ?? r.event)!.id;
      await api.post(`/approvals/${kind}/${docId}/reject`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Pending Approval</h1>
        <SearchBox
          placeholder="Search doc no, sales, unit, advertiser, brand..."
          value={searchInput}
          onChange={setSearchInput}
          onSearch={() => setSearch(searchInput)}
        />
      </div>
      <div className="toolbar" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} style={{ width: 200 }}>
            <option value="">{canActOnBehalf ? 'All Department' : 'All my Departments'}</option>
            {departmentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            From
            <DatePicker value={fromDate} onChange={setFromDate} style={{ width: 150 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
            To
            <DatePicker value={toDate} onChange={setToDate} style={{ width: 150 }} />
          </label>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Doc No</th>
              <th>Date</th>
              <th>Sales</th>
              <th>Department</th>
              <th>Unit</th>
              <th>Advertiser</th>
              <th>Brand</th>
              <th>Amount</th>
              <th>Step</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((r) => {
              const doc = r.expense ?? r.event;
              if (!doc) return null;
              const href = r.expense ? `/expenses/${doc.id}` : `/events/${doc.id}`;
              const docNo = r.expense ? doc.expenseNo : doc.eventNo;
              const amount = r.expense ? doc.amount : doc.estimatedAmount;
              const date = r.expense ? doc.expenseDate : doc.date;
              const currentStep = r.steps.find((s) => s.stepOrder === r.currentStep);
              const busy = busyId === r.id;
              return (
                <tr key={r.id}>
                  <td>{r.documentStage === 'PRE_EVENT' ? 'Pre-Event' : r.documentStage === 'EXPENSES' ? 'Expenses' : 'Settlement'}</td>
                  <td>
                    <Link href={href}>{docNo}</Link>
                  </td>
                  <td>{formatDate(date)}</td>
                  <td>{doc.sales?.name}</td>
                  <td>{doc.department?.name ?? '-'}</td>
                  <td>{doc.unit?.name}</td>
                  <td>{doc.advertiser?.name}</td>
                  <td>{doc.brand?.name}</td>
                  <td>{formatCurrency(amount ?? 0)}</td>
                  <td>
                    {r.currentStep + 1} / {r.steps.length} ({currentStep?.position.name ?? '-'})
                  </td>
                  <td>
                    {canActOn(currentStep) && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-success" disabled={busy} onClick={() => approve(r)}>
                          Approve
                        </button>
                        <button className="btn btn-danger" disabled={busy} onClick={() => reject(r)}>
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={11} style={{ color: 'var(--muted)' }}>Nothing pending your approval</td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredRows.length > 0 && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            total={pagination.total}
            rangeStart={pagination.rangeStart}
            rangeEnd={pagination.rangeEnd}
          />
        )}
      </div>
    </div>
  );
}
