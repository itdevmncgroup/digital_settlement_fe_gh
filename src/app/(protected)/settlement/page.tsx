'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import Modal from '@/components/Modal';
import DatePicker from '@/components/DatePicker';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface ApprovalStepInfo {
  stepOrder: number;
  status: string;
  position: { name: string };
  resolvedApprover: { id: string; name: string };
}

interface ApprovalRequestInfo {
  status: string;
  currentStep: number;
  steps: ApprovalStepInfo[];
}

interface SettlementExpenseRow {
  id: string;
  expenseNo: string;
  amount: string;
  status: string;
  sales: { name: string };
  bankTransactions: { id: string; status: string }[];
  approvalRequest: ApprovalRequestInfo | null;
}

interface SettlementRow {
  id: string;
  settlementNo: string;
  totalAmount: string;
  status: 'DRAFT' | 'COMPLETE';
  createdAt: string;
  pod: { id: string; name: string };
  department: { name: string } | null;
  createdBy: { name: string };
  expenses: SettlementExpenseRow[];
}

const MATCHED_TXN_STATUSES = ['AUTO_MATCHED', 'MANUAL_MATCHED'];

interface PodOption {
  id: string;
  name: string;
}

interface GeneratedExpenseRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  purpose: string;
  amount: string;
  status: string;
  sales: { name: string };
}

interface PreviewResult {
  expenses: GeneratedExpenseRow[];
  existingDraftSettlement: { id: string; settlementNo: string } | null;
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

export default function SettlementPage() {
  const { user, hasRole, hasPermission } = useAuth();
  const canManage = hasRole('ADMIN', 'FINANCE');
  const canGenerate = hasRole('SALES') || canManage || hasPermission('settlement.create.ownpod');
  const canViewBankMatching = canManage || hasPermission('expense.automatch');

  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [podOptions, setPodOptions] = useState<PodOption[]>([]);
  const [podFilter, setPodFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filteredRows = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.settlementNo, r.pod?.name, r.department?.name, r.createdBy?.name].some((v) => v?.toLowerCase().includes(q));
  });
  const pagination = usePagination(filteredRows);

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [genPodId, setGenPodId] = useState('');
  const [genFromDate, setGenFromDate] = useState(defaultFromDate);
  const [genToDate, setGenToDate] = useState(defaultToDate);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [submittingSettlement, setSubmittingSettlement] = useState(false);

  const [addModalSettlement, setAddModalSettlement] = useState<SettlementRow | null>(null);
  const [eligibleExpenses, setEligibleExpenses] = useState<GeneratedExpenseRow[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [addSelectedIds, setAddSelectedIds] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => {
    const qs = podFilter ? `?podId=${podFilter}` : '';
    api
      .get<SettlementRow[]>(`/settlements${qs}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, [podFilter]);

  useEffect(() => {
    const path = canManage ? '/pods' : '/pods/me';
    api.get<PodOption[]>(path).then(setPodOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const markComplete = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/settlements/${id}/complete`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark complete');
    } finally {
      setBusy(false);
    }
  };

  // Approve = re-affirm the transaction's existing match (manualMatch is
  // idempotent against the same expenseId); Reject = unmatch it. Both reuse
  // BankMatchingService's endpoints, same as the Expense detail page's
  // MATCH/NOT MATCH buttons and the Bank Matching Detail page.
  const approveTxn = async (transactionId: string, expenseId: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/bank-settlements/transactions/${transactionId}/match`, { expenseId });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const openGenerateModal = () => {
    setGenPodId('');
    setGenFromDate(defaultFromDate());
    setGenToDate(defaultToDate());
    setGenerateError('');
    setPreviewResult(null);
    setSelectedExpenseIds(new Set());
    setShowDuplicateConfirm(false);
    setShowGenerateModal(true);
  };

  // Preview-only: scopes the search to one POD + one date range (instead of
  // grabbing every eligible POD at once) and lists the matching, already
  // SETTLED/bank-matched Expenses for review - nothing is created yet, that's
  // the Submit step below (createNewSettlement / addSelectionToExisting).
  const generateSettlement = async () => {
    if (!genPodId) {
      setGenerateError('Pilih POD terlebih dahulu.');
      return;
    }
    setGenerating(true);
    setGenerateError('');
    setShowDuplicateConfirm(false);
    try {
      const result = await api.post<PreviewResult>('/settlements/generate', {
        podId: genPodId,
        fromDate: genFromDate,
        toDate: genToDate,
      });
      setPreviewResult(result);
      setSelectedExpenseIds(new Set(result.expenses.map((e) => e.id)));
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Generate Settlement failed');
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelectedExpense = (id: string) =>
    setSelectedExpenseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Submit: if a DRAFT settlement already covers this POD, ask "Buat baru" vs
  // "Tambahkan" before committing anything; otherwise there's nothing to
  // conflict with, so create the new settlement straight away.
  const submitSettlement = () => {
    if (selectedExpenseIds.size === 0) return;
    if (previewResult?.existingDraftSettlement) {
      setShowDuplicateConfirm(true);
      return;
    }
    createNewSettlement();
  };

  const createNewSettlement = async () => {
    setSubmittingSettlement(true);
    setGenerateError('');
    try {
      await api.post('/settlements/from-selection', { podId: genPodId, expenseIds: Array.from(selectedExpenseIds) });
      setShowGenerateModal(false);
      load();
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Failed to create settlement');
    } finally {
      setSubmittingSettlement(false);
    }
  };

  const addSelectionToExisting = async () => {
    if (!previewResult?.existingDraftSettlement) return;
    setSubmittingSettlement(true);
    setGenerateError('');
    try {
      await api.post(`/settlements/${previewResult.existingDraftSettlement.id}/expenses`, { expenseIds: Array.from(selectedExpenseIds) });
      setShowGenerateModal(false);
      load();
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Failed to add expenses');
    } finally {
      setSubmittingSettlement(false);
    }
  };

  // Lets a Sales/back-office user keep growing an already-created DRAFT
  // Settlement as more of that POD's Expenses become SETTLED/matched, instead
  // of only ever bundling them into a brand-new one via "Create Settlement".
  const openAddExpensesModal = (r: SettlementRow) => {
    setAddModalSettlement(r);
    setAddSelectedIds(new Set());
    setAddError('');
    setEligibleExpenses([]);
    setEligibleLoading(true);
    api
      .get<GeneratedExpenseRow[]>(`/settlements/${r.id}/eligible-expenses`)
      .then(setEligibleExpenses)
      .catch((err) => setAddError(err instanceof ApiError ? err.message : 'Failed to load eligible expenses'))
      .finally(() => setEligibleLoading(false));
  };

  const toggleAddSelected = (id: string) =>
    setAddSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submitAddExpenses = async () => {
    if (!addModalSettlement || addSelectedIds.size === 0) return;
    setAdding(true);
    setAddError('');
    try {
      await api.post(`/settlements/${addModalSettlement.id}/expenses`, { expenseIds: Array.from(addSelectedIds) });
      setAddModalSettlement(null);
      load();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Failed to add expenses');
    } finally {
      setAdding(false);
    }
  };

  const rejectTxn = async (transactionId: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/bank-settlements/transactions/${transactionId}/unmatch`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  // Per-Expense approval, one level step at a time - same ApprovalsService flow
  // (and the same endpoints) as the Approve/Reject buttons on the Expense detail
  // page, just surfaced here so an approver can clear an Expense's approval
  // without leaving the draft Settlement it's already been grouped into.
  const approveExpense = async (expenseId: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/approvals/expense/${expenseId}/approve`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const rejectExpense = async (expenseId: string) => {
    const reason = window.prompt('Reject reason:');
    if (!reason) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/approvals/expense/${expenseId}/reject`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Settlement</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search settlement no, POD, department..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <select value={podFilter} onChange={(e) => setPodFilter(e.target.value)} style={{ width: 220 }}>
            <option value="">{canManage ? 'All POD' : 'All my PODs'}</option>
            {podOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {canViewBankMatching && (
            <Link href="/bank-matching" className="btn">
              Bank Matching Detail
            </Link>
          )}
          {canGenerate && (
            <button className="btn btn-primary" onClick={openGenerateModal}>
              Create Settlement
            </button>
          )}
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8, fontSize: 12 }}>
        &quot;Create Settlement&quot; groups one POD&apos;s already bank-matched Expenses within a date range into a new draft
        Settlement - each Expense is then approved per its Approval Level from inside the Settlement below.
      </p>

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Settlement No</th>
              <th>Date</th>
              <th>POD</th>
              <th>Department</th>
              <th>Total Transaksi</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      onClick={() => setExpandedId((v) => (v === r.id ? '' : r.id))}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline', padding: 0 }}
                    >
                      {r.settlementNo}
                    </button>
                  </td>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>{r.pod?.name}</td>
                  <td>{r.department?.name || '-'}</td>
                  <td>{formatCurrency(r.totalAmount)}</td>
                  <td>
                    <span className={`badge ${r.status === 'COMPLETE' ? 'badge-success' : 'badge-info'}`}>{r.status}</span>
                  </td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    {canGenerate && r.status === 'DRAFT' && (
                      <button className="btn" disabled={busy} onClick={() => openAddExpensesModal(r)}>
                        Add Expenses
                      </button>
                    )}
                    {canManage && r.status === 'DRAFT' && (
                      <button className="btn btn-primary" disabled={busy} onClick={() => markComplete(r.id)}>
                        Mark Complete
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === r.id && (
                  <tr>
                    <td colSpan={7} style={{ background: 'var(--input-bg)' }}>
                      <div style={{ padding: 8 }}>
                        <strong style={{ fontSize: 12 }}>Expenses in this settlement ({r.expenses.length})</strong>
                        {r.expenses.map((e) => {
                          const txn = e.bankTransactions[0];
                          const matched = !!txn && MATCHED_TXN_STATUSES.includes(txn.status);
                          const approval = e.approvalRequest;
                          const currentStep = approval && approval.status === 'PENDING' ? approval.steps.find((s) => s.stepOrder === approval.currentStep) : null;
                          const canActOnExpense =
                            !!currentStep &&
                            (currentStep.resolvedApprover?.id === user?.id ||
                              hasRole('ADMIN') ||
                              hasPermission('expense.approve.all', 'expense.approve.ownpod'));
                          return (
                            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
                              <div style={{ flex: 1 }}>
                                <Link href={`/expenses/${e.id}`}>{e.expenseNo}</Link> — {e.sales?.name} — {formatCurrency(e.amount)}
                              </div>
                              <span className="badge badge-info">{e.status}</span>
                              {currentStep && (
                                <span style={{ color: 'var(--muted)', fontSize: 11 }}>waiting on {currentStep.position.name}</span>
                              )}
                              {canActOnExpense && (
                                <>
                                  <button className="btn btn-success" disabled={busy} onClick={() => approveExpense(e.id)}>
                                    Approve ({currentStep?.position.name})
                                  </button>
                                  <button className="btn btn-danger" disabled={busy} onClick={() => rejectExpense(e.id)}>
                                    Reject
                                  </button>
                                </>
                              )}
                              {txn && (
                                <>
                                  <span className={`badge ${matched ? 'badge-success' : 'badge-info'}`}>{matched ? 'Matched' : 'Not Matched'}</span>
                                  {canManage && (
                                    <>
                                      <button
                                        className="btn btn-success"
                                        disabled={busy || txn.status === 'MANUAL_MATCHED'}
                                        onClick={() => approveTxn(txn.id, e.id)}
                                      >
                                        Approve Match
                                      </button>
                                      <button className="btn btn-danger" disabled={busy || txn.status === 'UNMATCHED'} onClick={() => rejectTxn(txn.id)}>
                                        Reject Match
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                        {r.expenses.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No expenses</div>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--muted)' }}>
                  No settlements
                </td>
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

      {showGenerateModal && (
        <Modal title="Create Settlement" onClose={() => setShowGenerateModal(false)} wide>
          {/* minHeight reserves room below the date fields so the DatePicker's
              popover calendar (~300px tall) has space to render before Modal's
              shrink-wrapped card - overflow: hidden - clips anything past its
              own bounds; without this the popover got cut off. Kept even once
              previewResult comes back with zero expenses (no table to fill
              the space) so the popup doesn't visibly shrink on a "not found"
              result - only a populated table (which already exceeds 480px)
              drops the floor. */}
          <div style={{ minHeight: !previewResult || previewResult.expenses.length === 0 ? 480 : undefined }}>
            <div className="form-grid">
              <div className="form-row">
                <label>POD</label>
                <select value={genPodId} onChange={(e) => setGenPodId(e.target.value)}>
                  <option value="">Select POD</option>
                  {podOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>From</label>
                <DatePicker value={genFromDate} onChange={setGenFromDate} />
              </div>
              <div className="form-row">
                <label>To</label>
                <DatePicker value={genToDate} onChange={setGenToDate} />
              </div>
            </div>

            {generateError && <div className="error-text">{generateError}</div>}

            <button className="btn btn-primary" disabled={generating} style={{ marginTop: 12 }} onClick={generateSettlement}>
              {generating ? 'Generating...' : 'Generate Settlement'}
            </button>
          </div>

          {previewResult && (
            <div style={{ marginTop: 20 }}>
              {previewResult.expenses.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Tidak ada expense yang cocok (POD/tanggal/sudah matched) untuk dibuatkan settlement.
                </p>
              ) : (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}>
                          <input
                            type="checkbox"
                            style={{ width: 'auto' }}
                            checked={selectedExpenseIds.size === previewResult.expenses.length}
                            onChange={(e) =>
                              setSelectedExpenseIds(e.target.checked ? new Set(previewResult.expenses.map((x) => x.id)) : new Set())
                            }
                          />
                        </th>
                        <th>Expense No</th>
                        <th>Date</th>
                        <th>Sales</th>
                        <th>Purpose</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.expenses.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <input
                              type="checkbox"
                              style={{ width: 'auto' }}
                              checked={selectedExpenseIds.has(e.id)}
                              onChange={() => toggleSelectedExpense(e.id)}
                            />
                          </td>
                          <td>
                            <Link href={`/expenses/${e.id}`}>{e.expenseNo}</Link>
                          </td>
                          <td>{formatDate(e.expenseDate)}</td>
                          <td>{e.sales?.name}</td>
                          <td>{e.purpose}</td>
                          <td>{formatCurrency(e.amount)}</td>
                          <td>
                            <span className={`badge ${e.status === 'APPROVED' ? 'badge-success' : 'badge-info'}`}>{e.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {showDuplicateConfirm && previewResult.existingDraftSettlement ? (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: 'var(--input-bg)' }}>
                      <p style={{ fontSize: 13, marginTop: 0 }}>
                        Settlement sudah ada ({previewResult.existingDraftSettlement.settlementNo}), apakah Anda ingin menambahkan ke
                        Settlement yang sudah ada atau ingin membuat settlement baru?
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn" disabled={submittingSettlement} onClick={createNewSettlement}>
                          Buat baru
                        </button>
                        <button className="btn btn-primary" disabled={submittingSettlement} onClick={addSelectionToExisting}>
                          Tambahkan
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={submittingSettlement || selectedExpenseIds.size === 0}
                      style={{ marginTop: 12 }}
                      onClick={submitSettlement}
                    >
                      {submittingSettlement ? 'Submitting...' : `Submit (${selectedExpenseIds.size})`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </Modal>
      )}

      {addModalSettlement && (
        <Modal title={`Add Expenses to ${addModalSettlement.settlementNo}`} onClose={() => setAddModalSettlement(null)} wide>
          {eligibleLoading ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading eligible expenses...</p>
          ) : eligibleExpenses.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Tidak ada expense yang cocok (POD sama, sudah SETTLED &amp; matched, belum masuk settlement lain).
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={addSelectedIds.size === eligibleExpenses.length}
                      onChange={(e) => setAddSelectedIds(e.target.checked ? new Set(eligibleExpenses.map((x) => x.id)) : new Set())}
                    />
                  </th>
                  <th>Expense No</th>
                  <th>Date</th>
                  <th>Sales</th>
                  <th>Purpose</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {eligibleExpenses.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={addSelectedIds.has(e.id)}
                        onChange={() => toggleAddSelected(e.id)}
                      />
                    </td>
                    <td>
                      <Link href={`/expenses/${e.id}`}>{e.expenseNo}</Link>
                    </td>
                    <td>{formatDate(e.expenseDate)}</td>
                    <td>{e.sales?.name}</td>
                    <td>{e.purpose}</td>
                    <td>{formatCurrency(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {addError && <div className="error-text">{addError}</div>}

          <button
            className="btn btn-primary"
            disabled={adding || addSelectedIds.size === 0}
            style={{ marginTop: 12 }}
            onClick={submitAddExpenses}
          >
            {adding ? 'Adding...' : `Add Selected (${addSelectedIds.size})`}
          </button>
        </Modal>
      )}
    </div>
  );
}
