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
import { usePrompt } from '@/components/PromptDialog';

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
  isMyTurn: boolean;
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
  const canActOnBehalf = hasRole('ADMINISTRATOR');
  const prompt = usePrompt();

  const [rows, setRows] = useState<PendingApproval[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
  const canActOn = (step: StepInfo | undefined) => !!step && (step.resolvedApprover?.id === user?.id || hasRole('ADMINISTRATOR'));

  // Bulk selection is Expense-only, same restriction as the mobile app
  // (ApprovalsListScreen._selectable): a Pre-Event row still goes through its
  // own single approve/reject action, and Settlement rows aren't listed here
  // at all (they're reviewed member-by-member from the Settlement page).
  const isSelectable = (r: PendingApproval) => !!r.expense && canActOn(r.steps.find((s) => s.stepOrder === r.currentStep));

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  };

  const toggleSelected = (r: PendingApproval) => {
    if (!isSelectable(r)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(r.expense!.id)) next.delete(r.expense!.id);
      else next.add(r.expense!.id);
      return next;
    });
  };

  const toggleSelectAll = (visibleRows: PendingApproval[]) => {
    const selectableIds = visibleRows.filter(isSelectable).map((r) => r.expense!.id);
    setSelectedIds((prev) => (prev.size === selectableIds.length ? new Set() : new Set(selectableIds)));
  };

  // Backend has no batch approve/reject endpoint (see approvals.controller.ts) -
  // each selected expense fires its own call, one at a time so one failure
  // doesn't fire a burst of retries; failures are collected and reported
  // together instead of aborting the whole batch.
  const runBulk = async (call: (id: string) => Promise<unknown>) => {
    const ids = Array.from(selectedIds);
    setBulkBusy(true);
    let success = 0;
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await call(id);
        success++;
      } catch (err) {
        failures.push(err instanceof ApiError ? err.message : 'Failed');
      }
    }
    setBulkBusy(false);
    setSelectMode(false);
    setSelectedIds(new Set());
    setError(failures.length === 0 ? '' : `${success} succeeded, ${failures.length} failed: ${failures[0]}`);
    load();
  };

  const bulkApprove = () => runBulk((id) => api.post(`/approvals/expense/${id}/approve`));

  const bulkReject = async () => {
    const reason = await prompt({ title: `Reject ${selectedIds.size} expense(s)`, label: 'Reason', danger: true });
    if (!reason) return;
    runBulk((id) => api.post(`/approvals/expense/${id}/reject`, { reason }));
  };

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
    const reason = await prompt({ title: 'Reject reason', danger: true });
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
        <h1>{selectMode ? `${selectedIds.size} selected` : 'Pending Approval'}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search doc no, sales, unit, advertiser, brand..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <button className="btn" disabled={bulkBusy} onClick={toggleSelectMode}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>
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
      {selectMode && selectedIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedIds.size} expense(s) selected</span>
          <button className="btn btn-approve" disabled={bulkBusy} onClick={bulkApprove}>
            {bulkBusy ? 'Processing...' : 'Approve Selected'}
          </button>
          <button className="btn btn-reject" disabled={bulkBusy} onClick={bulkReject}>
            Reject Selected
          </button>
        </div>
      )}
      <div className="card">
        <table>
          <thead>
            <tr>
              {selectMode && (
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={
                      pagination.pageRows.some(isSelectable) &&
                      pagination.pageRows.filter(isSelectable).every((r) => selectedIds.has(r.expense!.id))
                    }
                    onChange={() => toggleSelectAll(pagination.pageRows)}
                  />
                </th>
              )}
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
              const selectable = isSelectable(r);
              return (
                <tr key={r.id} style={selectMode && !selectable ? { opacity: 0.5 } : undefined}>
                  {selectMode && (
                    <td>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        disabled={!selectable}
                        checked={selectable && selectedIds.has(r.expense!.id)}
                        onChange={() => toggleSelected(r)}
                      />
                    </td>
                  )}
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
                        <button className="btn btn-approve" disabled={busy} onClick={() => approve(r)}>
                          Approve
                        </button>
                        <button className="btn btn-reject" disabled={busy} onClick={() => reject(r)}>
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
                <td colSpan={selectMode ? 12 : 11} style={{ color: 'var(--muted)' }}>Nothing pending your approval</td>
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
