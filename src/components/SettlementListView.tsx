'use client';

import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, downloadFile, postForm } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/date';
import Modal from '@/components/Modal';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';
import { usePrompt } from '@/components/PromptDialog';
import SplashLoader from '@/components/SplashLoader';

interface ApprovalStepInfo {
  stepOrder: number;
  status: string;
  position: { name: string };
  resolvedApprover: { id: string; name: string };
}

interface ApprovalActionInfo {
  id: string;
  action: string;
  reason: string | null;
  actedAt: string;
  actor: { id: string; name: string };
  position: { name: string };
}

interface ApprovalRequestInfo {
  status: string;
  currentStep: number;
  steps: ApprovalStepInfo[];
  actions?: ApprovalActionInfo[];
}

interface SettlementExpenseRow {
  id: string;
  expenseNo: string;
  amount: string;
  status: string;
  sales: { name: string };
  isMatched: boolean;
  approvalRequest: ApprovalRequestInfo | null;
}

interface SettlementRow {
  id: string;
  settlementNo: string;
  totalAmount: string;
  // DRAFT (unused in practice) | DRAFT_SETTLEMENT | APPROVAL_SLS_MAR_DIR |
  // APPROVAL_VP_ACC_BIL_TAX_3TV | APPROVAL_CO_CFO_3TV | APPROVAL_HEAD_CORSEC | APPROVAL_SVP | REVISION | COMPLETE | REJECTED.
  status: string;
  // Only meaningful once status is COMPLETE - NOT_STARTED | PENDING | SENT | FAILED.
  odooSyncStatus: string;
  odooSyncError: string | null;
  // Unit picked in "Create Draft PR" (its code is the PR's org_id) - preselected when retrying a FAILED send.
  odooUnitId: string | null;
  createdAt: string;
  department: { id: string; name: string };
  createdBy: { name: string };
  expenses: SettlementExpenseRow[];
  // The batch's own tier (SLS_MAR_DIR -> VP -> CO_CFO) - separate from each
  // member Expense's own approvalRequest above.
  approvalRequest: ApprovalRequestInfo | null;
}

interface DepartmentOption {
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

interface UnitOption {
  id: string;
  code: string;
  name: string;
}

// GET /settlements/:id/draft-pr/preview - same columns as the Settlement
// Allocation section of the Settlement form.
interface DraftPrPreview {
  settlementNo: string;
  unit: UnitOption;
  rows: {
    id: string;
    product: string | null;
    unitCode: string;
    percentage: string;
    curr: string;
    qty: string;
    total: string;
    description: string | null;
  }[];
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

export default function SettlementPage() {
  return (
    <Suspense fallback={<SplashLoader message="Loading" />}>
      <SettlementPageInner />
    </Suspense>
  );
}

function SettlementPageInner() {
  const searchParams = useSearchParams();
  const { user, hasRole, hasPermission } = useAuth();
  const canManage = hasRole('ADMINISTRATOR');
  const canGenerate = hasRole('SALES') || canManage || hasPermission('settlement.create.owndept');
  const canViewBankMatching = canManage || hasPermission('expense.automatch');
  const prompt = usePrompt();

  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  // "Create Draft PR" (pick a Unit, send a COMPLETE settlement to Odoo): Admin, or
  // settlement.send.odoo.all for any settlement, or settlement.send.odoo.owndept
  // for settlements of the user's own Department(s) (/departments/me for non-Admin).
  const canDraftPr = (departmentId: string) =>
    canManage ||
    hasPermission('settlement.send.odoo.all') ||
    (hasPermission('settlement.send.odoo.owndept') && departmentOptions.some((d) => d.id === departmentId));
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filteredRows = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.settlementNo, r.department?.name, r.createdBy?.name].some((v) => v?.toLowerCase().includes(q));
  });
  const pagination = usePagination(filteredRows);

  const [submittingDraftId, setSubmittingDraftId] = useState('');

  const [addModalSettlement, setAddModalSettlement] = useState<SettlementRow | null>(null);
  const [eligibleExpenses, setEligibleExpenses] = useState<GeneratedExpenseRow[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [addSelectedIds, setAddSelectedIds] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const [draftPrSettlement, setDraftPrSettlement] = useState<SettlementRow | null>(null);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const [draftPrUnitId, setDraftPrUnitId] = useState('');
  const [draftPrPreview, setDraftPrPreview] = useState<DraftPrPreview | null>(null);
  const [draftPrLoading, setDraftPrLoading] = useState(false);
  const [draftPrSending, setDraftPrSending] = useState(false);
  const [draftPrPdfLoading, setDraftPrPdfLoading] = useState(false);
  const [draftPrError, setDraftPrError] = useState('');
  // Bank statement PDF whose pages get inserted after the Form Jamuan pages.
  const [draftPrStatement, setDraftPrStatement] = useState<File | null>(null);

  const load = () => {
    const qs = departmentFilter ? `?departmentId=${departmentFilter}` : '';
    api
      .get<SettlementRow[]>(`/settlements${qs}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, [departmentFilter]);

  // Lands here from the settlement approval email/push deep link
  // (`${APP_PUBLIC_URL}/settlement?open=<id>`, see approvals.service.ts
  // notifyStep) - auto-expand and scroll to that row once it's loaded.
  useEffect(() => {
    const open = searchParams.get('open');
    if (!open || rows.length === 0) return;
    setExpandedId(open);
    document.getElementById(`settlement-row-${open}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, rows]);

  useEffect(() => {
    const path = canManage ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
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

  // DRAFT_SETTLEMENT -> APPROVAL_SLS_MAR_DIR: starts the settlement's own
  // approval chain (SettlementsService.submitDraft).
  const submitDraft = async (id: string) => {
    setSubmittingDraftId(id);
    setError('');
    try {
      await api.post(`/settlements/${id}/submit-draft`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit settlement');
    } finally {
      setSubmittingDraftId('');
    }
  };

  // Lets a Sales/back-office user keep growing an already-created DRAFT
  // Settlement as more of that Department's Expenses become SETTLED/matched,
  // instead of only ever bundling them into a brand-new one via "Create Settlement".
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
    const reason = await prompt({ title: 'Reject reason', danger: true });
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

  // Sends the expense back exactly one approval tier instead of rejecting it
  // outright - the owner can then edit and resubmit at that same tier.
  const reviseExpense = async (expenseId: string) => {
    const reason = await prompt({ title: 'Revise reason (send back one tier)', danger: true });
    if (!reason) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/approvals/expense/${expenseId}/revise`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revise failed');
    } finally {
      setBusy(false);
    }
  };

  const loadDraftPrPreview = async (settlementId: string, unitId: string) => {
    setDraftPrLoading(true);
    try {
      setDraftPrPreview(await api.get<DraftPrPreview>(`/settlements/${settlementId}/draft-pr/preview?unitId=${unitId}`));
    } catch (err) {
      setDraftPrPreview(null);
      setDraftPrError(err instanceof ApiError ? err.message : 'Failed to load preview');
    } finally {
      setDraftPrLoading(false);
    }
  };

  // Also the "Retry" action of a FAILED send: same popup, with the Unit used last
  // time preselected and the preview loaded. The bank statement has to be picked
  // again (it isn't stored), which is why retry goes through here and not straight
  // to /retry-sync.
  const openDraftPr = (r: SettlementRow) => {
    const retryUnitId = r.odooSyncStatus === 'FAILED' ? r.odooUnitId ?? '' : '';
    setDraftPrSettlement(r);
    setDraftPrUnitId(retryUnitId);
    setDraftPrPreview(null);
    setDraftPrStatement(null);
    setDraftPrError(
      r.odooSyncStatus === 'FAILED' ? `Last send to Odoo failed${r.odooSyncError ? `: ${r.odooSyncError}` : ''}. You can try again.` : '',
    );
    if (unitOptions.length === 0) {
      api.get<UnitOption[]>('/units?active=true').then(setUnitOptions).catch(() => setDraftPrError('Failed to load units'));
    }
    if (retryUnitId) loadDraftPrPreview(r.id, retryUnitId);
  };

  const previewDraftPr = async () => {
    if (!draftPrSettlement || !draftPrUnitId) return;
    setDraftPrError('');
    await loadDraftPrPreview(draftPrSettlement.id, draftPrUnitId);
  };

  // The API never throws on a failed Odoo push - it records FAILED + the error on
  // the Settlement, so read the result instead of assuming success.
  const sendDraftPr = async () => {
    if (!draftPrSettlement || !draftPrUnitId) return;
    setDraftPrSending(true);
    setDraftPrError('');
    try {
      // Multipart so the picked bank statement goes with it - the server rebuilds
      // the same PDF as "Generate PDF" and sends it to Odoo as the attachment.
      const res = await postForm<{ odooSyncStatus: string; odooSyncError: string | null }>(
        `/settlements/${draftPrSettlement.id}/draft-pr/send`,
        { unitId: draftPrUnitId },
        draftPrStatement,
      );
      load();
      if (res.odooSyncStatus === 'SENT') setDraftPrSettlement(null);
      else setDraftPrError(`Send to Odoo failed${res.odooSyncError ? `: ${res.odooSyncError}` : ''}. You can try again.`);
    } catch (err) {
      setDraftPrError(err instanceof ApiError ? err.message : 'Failed to send to Odoo');
    } finally {
      setDraftPrSending(false);
    }
  };

  // Server builds the attachment PDF (Form Jamuan table, bank statement pages,
  // photos/invoices per expense) - can take a few seconds with many images.
  const downloadDraftPrPdf = async () => {
    if (!draftPrSettlement) return;
    setDraftPrPdfLoading(true);
    setDraftPrError('');
    try {
      await downloadFile(`/settlements/${draftPrSettlement.id}/pdf`, `${draftPrSettlement.settlementNo}.pdf`, draftPrStatement);
    } catch (err) {
      setDraftPrError(err instanceof ApiError ? err.message : 'Failed to generate PDF');
    } finally {
      setDraftPrPdfLoading(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Settlement</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search settlement no, department..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} style={{ width: 220 }}>
            <option value="">{canManage ? 'All Departments' : 'All my Departments'}</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {canViewBankMatching && (
            <Link href="/bank-matching" className="btn">
              Bank Matching Detail
            </Link>
          )}
          {canGenerate && (
            <Link href="/settlement/create" className="btn btn-primary">
              Create Settlement
            </Link>
          )}
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8, fontSize: 12 }}>
        &quot;Create Settlement&quot;: pick a Department and date range, click Search to list its already bank-matched Expenses,
        check the ones to include, then click Generate Settlement - each Expense is then approved per its Approval Level from
        inside the Settlement below.
      </p>

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Settlement No</th>
              <th>Date</th>
              <th>Department</th>
              <th>Total Transaksi</th>
              <th>Status</th>
              <th>Sent to Odoo</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((r) => (
              <Fragment key={r.id}>
                <tr id={`settlement-row-${r.id}`}>
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
                  <td>{r.department?.name}</td>
                  <td>{formatCurrency(r.totalAmount)}</td>
                  <td>
                    <span className={`badge ${r.status === 'COMPLETE' ? 'badge-success' : 'badge-info'}`}>{r.status}</span>
                  </td>
                  <td>
                    {r.status === 'COMPLETE' ? (
                      <span
                        className={`badge ${
                          r.odooSyncStatus === 'SENT' ? 'badge-success' : r.odooSyncStatus === 'FAILED' ? 'badge-danger' : 'badge-warning'
                        }`}
                        title={r.odooSyncStatus === 'FAILED' ? r.odooSyncError ?? '' : undefined}
                      >
                        {r.odooSyncStatus}
                      </span>
                    ) : (
                      <span className="badge badge-info">-</span>
                    )}
                  </td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    {canGenerate && (r.status === 'DRAFT_SETTLEMENT' || r.status === 'REVISION') && (
                      <Link href={`/settlement/${r.id}/edit`} className="btn">
                        {r.status === 'REVISION' ? 'Resubmit' : 'Edit'}
                      </Link>
                    )}
                    {canGenerate && r.status === 'DRAFT_SETTLEMENT' && (
                      <button className="btn" disabled={busy} onClick={() => openAddExpensesModal(r)}>
                        Add Expenses
                      </button>
                    )}
                    {canGenerate && r.status === 'DRAFT_SETTLEMENT' && (
                      <button
                        className="btn btn-primary"
                        disabled={busy || submittingDraftId === r.id}
                        onClick={() => submitDraft(r.id)}
                      >
                        {submittingDraftId === r.id ? 'Submitting...' : 'Submit'}
                      </button>
                    )}
                    {canManage && r.status === 'DRAFT' && (
                      <button className="btn btn-primary" disabled={busy} onClick={() => markComplete(r.id)}>
                        Mark Complete
                      </button>
                    )}
                    {canDraftPr(r.department.id) && r.status === 'COMPLETE' && (
                      <button
                        className="btn"
                        title={r.odooSyncStatus === 'SENT' ? 'Already sent to Odoo' : 'Create Draft PR'}
                        aria-label="Create Draft PR"
                        disabled={busy || r.odooSyncStatus === 'SENT'}
                        onClick={() => openDraftPr(r)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                          <path d="M14 3v5h5" />
                          <path d="M12 12v6M9 15h6" />
                        </svg>
                      </button>
                    )}
                    {canDraftPr(r.department.id) && r.status === 'COMPLETE' && r.odooSyncStatus === 'FAILED' && (
                      <button
                        className="btn btn-primary"
                        title={r.odooSyncError ? `Send to Odoo failed: ${r.odooSyncError}` : 'Send to Odoo failed'}
                        disabled={busy}
                        onClick={() => openDraftPr(r)}
                      >
                        Retry Send to Odoo
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
                          // isMatched is the source of truth - also true for a manual
                          // match with no billing-statement transaction at all (e.g.
                          // e-wallet/personal reimbursement), which bankTransactions
                          // alone wouldn't show.
                          const matched = e.isMatched;
                          const approval = e.approvalRequest;
                          const currentStep = approval && approval.status === 'PENDING' ? approval.steps.find((s) => s.stepOrder === approval.currentStep) : null;
                          const canActOnExpense =
                            !!currentStep &&
                            (currentStep.resolvedApprover?.id === user?.id ||
                              hasRole('ADMINISTRATOR') ||
                              hasPermission('expense.approve.all', 'expense.approve.owndept'));
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
                                  <button className="btn btn-approve" disabled={busy} onClick={() => approveExpense(e.id)}>
                                    Approve ({currentStep?.position.name})
                                  </button>
                                  <button className="btn" disabled={busy} onClick={() => reviseExpense(e.id)}>
                                    Revise
                                  </button>
                                  <button className="btn btn-reject" disabled={busy} onClick={() => rejectExpense(e.id)}>
                                    Reject
                                  </button>
                                </>
                              )}
                              <span className={`badge ${matched ? 'badge-success' : 'badge-info'}`}>{matched ? 'Matched' : 'Not Matched'}</span>
                            </div>
                          );
                        })}
                        {r.expenses.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No expenses</div>}

                        <strong style={{ fontSize: 12, display: 'block', marginTop: 16 }}>
                          Settlement Approval History
                        </strong>
                        <table style={{ marginTop: 4 }}>
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>Position</th>
                              <th>Action</th>
                              <th>Approved By</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(r.approvalRequest?.actions ?? []).map((a) => (
                              <tr key={a.id}>
                                <td>{formatDateTime(a.actedAt)}</td>
                                <td>{a.position?.name}</td>
                                <td>{a.action}</td>
                                <td>{a.actor?.name}</td>
                                <td>{a.reason || '-'}</td>
                              </tr>
                            ))}
                            {(r.approvalRequest?.actions ?? []).length === 0 && (
                              <tr>
                                <td colSpan={5} style={{ color: 'var(--muted)' }}>No actions yet</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
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

      {draftPrSettlement && (
        <Modal title={`${draftPrSettlement.odooSyncStatus === 'FAILED' ? 'Retry Send to Odoo' : 'Create Draft PR'} - ${draftPrSettlement.settlementNo}`} onClose={() => setDraftPrSettlement(null)} wide>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={draftPrUnitId}
              onChange={(e) => {
                setDraftPrUnitId(e.target.value);
                setDraftPrPreview(null);
                setDraftPrError('');
              }}
              style={{ width: 240 }}
              aria-label="Unit"
            >
              <option value="">Select Unit...</option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!draftPrUnitId || draftPrLoading || draftPrSending} onClick={previewDraftPr}>
              {draftPrLoading ? 'Loading...' : 'Preview'}
            </button>
          </div>

          {draftPrPreview && (
            <>
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Unit</th>
                    <th>Persentase (%)</th>
                    <th>Currency</th>
                    <th>Quantity</th>
                    <th>Total</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {draftPrPreview.rows.map((a) => (
                    <tr key={a.id}>
                      <td>{a.product ?? '-'}</td>
                      <td>{a.unitCode}</td>
                      <td>{Number(a.percentage)}</td>
                      <td>{a.curr}</td>
                      <td>{Number(a.qty)}</td>
                      <td>{formatCurrency(a.total)}</td>
                      <td>{a.description ?? '-'}</td>
                    </tr>
                  ))}
                  {draftPrPreview.rows.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--muted)' }}>
                        No allocation lines
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Bank Statement (PDF)</label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="Bank Statement PDF"
                  disabled={draftPrPdfLoading || draftPrSending}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && file.type !== 'application/pdf') {
                      setDraftPrStatement(null);
                      e.target.value = '';
                      setDraftPrError('Bank statement must be a PDF file');
                      return;
                    }
                    setDraftPrStatement(file);
                    setDraftPrError('');
                  }}
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Optional. Every page is added after the Form Jamuan pages. Without a file, no bank statement is included in the PDF.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn" disabled={draftPrPdfLoading || draftPrSending} onClick={downloadDraftPrPdf}>
                  {draftPrPdfLoading ? 'Generating PDF...' : 'Generate PDF'}
                </button>
                <button className="btn btn-primary" disabled={draftPrSending || draftPrPdfLoading} onClick={sendDraftPr}>
                  {draftPrSending ? 'Sending...' : 'Send To Odoo'}
                </button>
              </div>
            </>
          )}

          {draftPrError && <div className="error-text">{draftPrError}</div>}
        </Modal>
      )}

      {addModalSettlement && (
        <Modal title={`Add Expenses to ${addModalSettlement.settlementNo}`} onClose={() => setAddModalSettlement(null)} wide>
          {eligibleLoading ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading eligible expenses...</p>
          ) : eligibleExpenses.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Tidak ada expense yang cocok (Department sama, sudah SETTLED &amp; matched, belum masuk settlement lain).
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
