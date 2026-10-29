'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import Modal from '@/components/Modal';
import ExpenseImagesModal from '@/components/ExpenseImagesModal';
import { NavIcon } from '@/components/NavIcons';
import { useConfirm } from '@/components/ConfirmDialog';
import { usePrompt } from '@/components/PromptDialog';

interface StepInfo {
  stepOrder: number;
  status: string;
  position: { name: string };
  resolvedApprover?: { id: string; name: string };
}

interface SettlementExpense {
  id: string;
  expenseNo: string;
  expenseDate?: string;
  amount: string;
  purpose: string;
  status: string;
  sales: { id: string; name: string };
  advertiser: { name: string } | null;
  brand: { name: string } | null;
  activityType?: { name: string } | null;
  settlementApprovedStep: number | null;
}

interface SettlementDetail {
  id: string;
  settlementNo: string;
  totalAmount: string;
  department: { name: string };
  createdBy: { name: string };
  approvalRequest: { status: string; currentStep: number; steps: StepInfo[] } | null;
  expenses: SettlementExpense[];
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Desktop review of a Settlement tier (opened from the Approval page / the "Desktop Mode" email link): the
// tier's approver approves or rejects every member Expense one by one (same endpoints as the mobile page
// /m/approvals/settlement/[id]), can look at each Expense's activity + invoice images, then submits the batch.
export default function SettlementApprovalModal({
  settlementId,
  onClose,
  onChanged,
}: {
  settlementId: string;
  onClose: () => void;
  /** Called after anything that changes approval state, so the list behind the popup can reload. */
  onChanged?: () => void;
}) {
  const { user, hasRole } = useAuth();
  const prompt = usePrompt();
  const confirm = useConfirm();

  const [settlement, setSettlement] = useState<SettlementDetail | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [imagesExpenseId, setImagesExpenseId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = async () => {
    try {
      setSettlement(await api.get<SettlementDetail>(`/settlements/${settlementId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  };
  useEffect(() => {
    setSettlement(null);
    setError('');
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementId]);

  const ar = settlement?.approvalRequest;
  const currentStep = ar ? ar.steps.find((s) => s.stepOrder === ar.currentStep) : undefined;
  const canAct = !!ar && ar.status === 'PENDING' && (currentStep?.resolvedApprover?.id === user?.id || hasRole('ADMINISTRATOR'));
  const isReviewed = (e: SettlementExpense) => (e.settlementApprovedStep ?? -1) >= (ar?.currentStep ?? 0);
  const allReviewed = !!settlement && settlement.expenses.length > 0 && settlement.expenses.every(isReviewed);
  // Every member Expense was rejected out: submitting closes (REJECTs) the whole Settlement, so it is confirmed first.
  const isEmptyPending = !!settlement && settlement.expenses.length === 0 && canAct;

  const act = async (e: SettlementExpense, action: 'approve' | 'reject') => {
    let body: { reason: string } | undefined;
    if (action === 'reject') {
      const reason = await prompt({ title: `Reject ${e.expenseNo} - reason`, danger: true });
      if (!reason) return;
      body = { reason };
    }
    setBusyId(e.id);
    setError('');
    try {
      await api.post(`/settlements/${settlementId}/expenses/${e.id}/${action}`, body);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${action} failed`);
    } finally {
      setBusyId('');
    }
  };

  const isSelectable = (e: SettlementExpense) => canAct && !isReviewed(e);
  const selectable = (settlement?.expenses ?? []).filter(isSelectable);
  const allSelected = selectable.length > 0 && selectable.every((e) => selectedIds.has(e.id));
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(selectable.map((e) => e.id)));

  // No batch endpoint: each selected Expense fires its own call, failures are collected and reported together.
  const runBulk = async (call: (expenseId: string) => Promise<unknown>) => {
    const ids = selectable.filter((e) => selectedIds.has(e.id));
    setBulkBusy(true);
    setError('');
    let success = 0;
    const failures: string[] = [];
    for (const e of ids) {
      try {
        await call(e.id);
        success++;
      } catch (err) {
        failures.push(`${e.expenseNo}: ${err instanceof ApiError ? err.message : 'Failed'}`);
      }
    }
    setSelectedIds(new Set());
    setBulkBusy(false);
    if (failures.length) setError(`${success} succeeded, ${failures.length} failed - ${failures.join('; ')}`);
    await refresh();
    onChanged?.();
  };
  const bulkApprove = () => runBulk((id) => api.post(`/settlements/${settlementId}/expenses/${id}/approve`));
  const bulkReject = async () => {
    const reason = await prompt({ title: `Reject ${selectedIds.size} expense(s) - reason`, danger: true });
    if (!reason) return;
    await runBulk((id) => api.post(`/settlements/${settlementId}/expenses/${id}/reject`, { reason }));
  };

  const submitTier = async () => {
    if (isEmptyPending) {
      const ok = await confirm({
        title: 'Reject this Settlement?',
        message: 'Every Expense was rejected out of the batch, so submitting rejects the whole Settlement.',
        danger: true,
      });
      if (!ok) return;
    }
    setSubmitBusy(true);
    setError('');
    try {
      await api.post(`/settlements/${settlementId}/submit`);
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed');
    } finally {
      setSubmitBusy(false);
    }
  };

  // Sends the whole batch back exactly one tier (available any time it is this approver's turn).
  const reviseTier = async () => {
    const reason = await prompt({ title: 'Revise reason (send the batch back one tier)', danger: true });
    if (!reason) return;
    setSubmitBusy(true);
    setError('');
    try {
      await api.post(`/settlements/${settlementId}/revise`, { reason });
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revise failed');
    } finally {
      setSubmitBusy(false);
    }
  };

  return (
    <>
      <Modal title={settlement ? `Settlement ${settlement.settlementNo}` : 'Settlement'} onClose={onClose} wide>
        {error && <div className="error-text">{error}</div>}
        {!settlement && !error && <div>Loading...</div>}
        {settlement && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Created By</div>
                <div>{settlement.createdBy?.name}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Department</div>
                <div>{settlement.department?.name ?? '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Total Amount</div>
                <div style={{ fontWeight: 700 }}>{formatCurrency(settlement.totalAmount ?? 0)}</div>
              </div>
              {ar && currentStep && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Approval Step</div>
                  <div>
                    {ar.currentStep + 1}/{ar.steps.length} · {currentStep.position.name}
                    {currentStep.resolvedApprover ? ` (${currentStep.resolvedApprover.name})` : ''}
                  </div>
                </div>
              )}
            </div>
            {ar && ar.status === 'PENDING' && !canAct && (
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>It is not your turn to review this Settlement.</div>
            )}

            {canAct && selectable.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={allSelected} disabled={bulkBusy} onChange={toggleSelectAll} style={{ width: 'auto' }} />
                  Select all ({selectable.length})
                </label>
                {selectedIds.size > 0 && (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedIds.size} selected</span>
                    <div className="row-actions" style={{ marginLeft: 'auto' }}>
                      <button type="button" className="btn btn-approve btn-xs" disabled={bulkBusy || submitBusy} onClick={bulkApprove}>
                        {bulkBusy ? 'Working...' : `Approve selected (${selectedIds.size})`}
                      </button>
                      <button type="button" className="btn btn-reject btn-xs" disabled={bulkBusy || submitBusy} onClick={bulkReject}>
                        Reject selected ({selectedIds.size})
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    {canAct && (
                      <th style={{ width: 1 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          disabled={selectable.length === 0 || bulkBusy}
                          onChange={toggleSelectAll}
                          title="Select all pending expenses"
                          aria-label="Select all pending expenses"
                          style={{ width: 'auto' }}
                        />
                      </th>
                    )}
                    <th>Expense No</th>
                    <th>Date</th>
                    <th>Requestor</th>
                    <th>Advertiser / Brand</th>
                    <th>Purpose</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Review</th>
                    <th style={{ width: 1, whiteSpace: 'nowrap' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {settlement.expenses.map((e) => {
                    const reviewed = isReviewed(e);
                    const busy = busyId === e.id;
                    return (
                      <tr key={e.id}>
                        {canAct && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(e.id)}
                              disabled={!isSelectable(e) || bulkBusy}
                              onChange={() => toggleSelected(e.id)}
                              aria-label={`Select ${e.expenseNo}`}
                              style={{ width: 'auto' }}
                            />
                          </td>
                        )}
                        <td style={{ whiteSpace: 'nowrap' }}>{e.expenseNo}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{e.expenseDate ? formatDate(e.expenseDate) : '-'}</td>
                        <td>{e.sales?.name}</td>
                        <td>{[e.advertiser?.name, e.brand?.name].filter(Boolean).join(' / ') || '-'}</td>
                        <td style={{ maxWidth: 220 }}>{e.purpose}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatCurrency(e.amount)}</td>
                        <td>
                          <span className={`badge ${reviewed ? 'badge-success' : 'badge-info'}`}>{reviewed ? 'Approved' : 'Pending'}</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-xs btn-icon-xs"
                              onClick={() => setImagesExpenseId(e.id)}
                              title="View activity and invoice photos"
                              aria-label="View activity and invoice photos"
                            >
                              <NavIcon name="eye" />
                            </button>
                            {canAct && !reviewed && (
                              <>
                                <button type="button" className="btn btn-approve btn-xs" disabled={busy || submitBusy || bulkBusy} onClick={() => act(e, 'approve')}>
                                  Approve
                                </button>
                                <button type="button" className="btn btn-reject btn-xs" disabled={busy || submitBusy || bulkBusy} onClick={() => act(e, 'reject')}>
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {settlement.expenses.length === 0 && (
                    <tr>
                      <td colSpan={canAct ? 9 : 8} style={{ color: 'var(--muted)' }}>No expenses left in this Settlement</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {canAct && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn" disabled={submitBusy} onClick={reviseTier}>
                  Revise
                </button>
                <button type="button" className="btn btn-primary" disabled={submitBusy || !(allReviewed || isEmptyPending)} onClick={submitTier}>
                  {submitBusy ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            )}
            {canAct && !allReviewed && !isEmptyPending && (
              <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'right', marginTop: 4 }}>Review every Expense before submitting.</div>
            )}
          </>
        )}
      </Modal>
      {imagesExpenseId && <ExpenseImagesModal expenseId={imagesExpenseId} onClose={() => setImagesExpenseId(null)} />}
    </>
  );
}
