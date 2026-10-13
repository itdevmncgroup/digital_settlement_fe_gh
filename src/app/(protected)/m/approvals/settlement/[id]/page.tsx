'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCurrency, SkeletonList, StatusBadge } from '@/lib/mobileUi';

interface StepInfo {
  stepOrder: number;
  status: string;
  position: { name: string };
  resolvedApprover?: { id: string; name: string };
}

interface SettlementExpense {
  id: string;
  expenseNo: string;
  amount: string;
  purpose: string;
  status: string;
  sales: { id: string; name: string };
  advertiser: { name: string };
  brand: { name: string };
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

// Mobile drill-down for a Settlement-stage approval row: the tier's approver
// reviews every member Expense individually (approve/reject, multi-select
// supported), then presses Submit to close the tier - mirrors the desktop
// Settlement page's review flow (ApprovalsService.reviewSettlementExpense /
// submitSettlementTier).
export default function MobileSettlementApprovalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, hasRole } = useAuth();

  const [settlement, setSettlement] = useState<SettlementDetail | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejecting, setRejecting] = useState<SettlementExpense | null>(null);
  const [reason, setReason] = useState('');

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reviseReason, setReviseReason] = useState('');
  // Closing an empty batch (every member Expense rejected out) permanently
  // REJECTs the whole Settlement (see submitTier) - that must never fire
  // without the approver explicitly confirming it, so it's gated behind this
  // sheet instead of running automatically off a refresh.
  const [closeConfirming, setCloseConfirming] = useState(false);

  // See the matching comment in /m/approvals: delay past the m-sheet-up
  // animation so the keyboard doesn't fight it on iOS Safari.
  const rejectTextareaRef = useRef<HTMLTextAreaElement>(null);
  const bulkRejectTextareaRef = useRef<HTMLTextAreaElement>(null);
  const reviseTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!rejecting) return;
    const t = setTimeout(() => rejectTextareaRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [rejecting]);
  useEffect(() => {
    if (!bulkRejecting) return;
    const t = setTimeout(() => bulkRejectTextareaRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [bulkRejecting]);
  useEffect(() => {
    if (!revising) return;
    const t = setTimeout(() => reviseTextareaRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [revising]);

  const refresh = async () => {
    try {
      const s = await api.get<SettlementDetail>(`/settlements/${id}`);
      setSettlement(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const ar = settlement?.approvalRequest;
  const currentStep = ar ? ar.steps.find((s) => s.stepOrder === ar.currentStep) : undefined;
  const canAct = !!ar && ar.status === 'PENDING' && (currentStep?.resolvedApprover?.id === user?.id || hasRole('ADMINISTRATOR'));
  const isReviewed = (e: SettlementExpense) => (e.settlementApprovedStep ?? -1) >= (ar?.currentStep ?? 0);
  const allReviewed = !!settlement && settlement.expenses.length > 0 && settlement.expenses.every(isReviewed);
  // Every member Expense was rejected out of the batch - submitting from here
  // does not advance the tier, it REJECTs the whole Settlement (see
  // submitSettlementTier's zero-expenses branch), so this is treated as a
  // distinct, explicitly-confirmed action rather than the normal tier submit.
  const isEmptyPending = !!settlement && settlement.expenses.length === 0 && canAct;

  const act = async (e: SettlementExpense, action: 'approve' | 'reject', body?: { reason: string }) => {
    setBusyId(e.id);
    setError('');
    try {
      await api.post(`/settlements/${id}/expenses/${e.id}/${action}`, body);
      closeReject();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${action} failed`);
    } finally {
      setBusyId('');
    }
  };

  const closeReject = () => {
    setRejecting(null);
    setReason('');
  };

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  };

  const isSelectable = (e: SettlementExpense) => canAct && !isReviewed(e);

  const toggleSelected = (e: SettlementExpense) => {
    if (!isSelectable(e)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
  };

  const selectableExpenses = (settlement?.expenses ?? []).filter(isSelectable);
  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === selectableExpenses.length ? new Set() : new Set(selectableExpenses.map((e) => e.id))));
  };

  // Same pattern as /m/approvals: no batch endpoint, so each selected expense
  // fires its own call one at a time, failures collected and reported together.
  const runBulk = async (call: (id: string) => Promise<unknown>) => {
    const ids = Array.from(selectedIds);
    const labelById = new Map((settlement?.expenses ?? []).map((e) => [e.id, e.expenseNo]));
    setBulkBusy(true);
    let success = 0;
    const failures: string[] = [];
    for (const eid of ids) {
      try {
        await call(eid);
        success++;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed';
        failures.push(`${labelById.get(eid) ?? eid}: ${message}`);
      }
    }
    setBulkBusy(false);
    setBulkRejecting(false);
    setBulkReason('');
    setSelectMode(false);
    setSelectedIds(new Set());
    setError(failures.length === 0 ? '' : `${success} succeeded, ${failures.length} failed - ${failures.join('; ')}`);
    await refresh();
  };

  const bulkApprove = () => runBulk((eid) => api.post(`/settlements/${id}/expenses/${eid}/approve`));
  const bulkReject = () => runBulk((eid) => api.post(`/settlements/${id}/expenses/${eid}/reject`, { reason: bulkReason.trim() }));

  const submitTier = async () => {
    setSubmitBusy(true);
    setError('');
    try {
      await api.post(`/settlements/${id}/submit`);
      router.push('/m/approvals');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed');
      setCloseConfirming(false);
    } finally {
      setSubmitBusy(false);
    }
  };

  // Sends the whole batch back exactly one tier instead of finishing the
  // per-expense review - available any time it's this approver's turn, not
  // only once every expense has been individually reviewed (that's the point
  // of bouncing the batch mid-review).
  const reviseTier = async () => {
    setSubmitBusy(true);
    setError('');
    try {
      await api.post(`/settlements/${id}/revise`, { reason: reviseReason.trim() });
      router.push('/m/approvals');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revise failed');
    } finally {
      setSubmitBusy(false);
      setRevising(false);
      setReviseReason('');
    }
  };

  if (error && !settlement) {
    return (
      <div className="error-text" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <span>{error}</span>
        <button className="btn" style={{ minHeight: 30 }} onClick={() => { setError(''); refresh(); }}>
          Retry
        </button>
      </div>
    );
  }
  if (!settlement) return <SkeletonList />;

  return (
    <div style={{ paddingBottom: (selectMode && selectedIds.size > 0) || (canAct && (allReviewed || isEmptyPending)) ? 96 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Explicit destination, not router.back() - this page is reachable from
            a deep link (dashboard tile, notification), where "back" can leave
            the app instead of returning to the approvals inbox. */}
        <button type="button" className="btn" onClick={() => router.push('/m/approvals')} title="Back">
          ← Back
        </button>
        <h1 style={{ margin: 0 }}>{settlement.settlementNo}</h1>
      </div>
      <div className="m-subtitle">
        {settlement.createdBy?.name} · {settlement.department?.name} · {formatCurrency(settlement.totalAmount ?? 0)}
      </div>
      {ar && currentStep && (
        <div className="m-subtitle">
          Step {ar.currentStep + 1}/{ar.steps.length} · {currentStep.position.name}
          {currentStep.resolvedApprover ? ` (${currentStep.resolvedApprover.name})` : ''}
        </div>
      )}

      {error && <div className="error-text">{error}</div>}

      {canAct && !selectMode && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, margin: '8px 0' }}>
          <button className="btn" style={{ minHeight: 36 }} disabled={bulkBusy || submitBusy} onClick={() => setRevising(true)}>
            Revise
          </button>
          {selectableExpenses.length > 0 && (
            <button className="btn" style={{ minHeight: 36 }} disabled={bulkBusy} onClick={toggleSelectMode}>
              Select
            </button>
          )}
        </div>
      )}
      {selectMode && selectableExpenses.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
          <button className="btn" style={{ minHeight: 36 }} disabled={bulkBusy} onClick={toggleSelectMode}>
            Cancel
          </button>
        </div>
      )}

      {selectMode && selectableExpenses.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '4px 2px 12px' }}>
          <input
            type="checkbox"
            style={{ width: 18, height: 18 }}
            checked={selectedIds.size === selectableExpenses.length}
            onChange={toggleSelectAll}
          />
          Select all ({selectableExpenses.length})
        </label>
      )}

      {settlement.expenses.length === 0 && (
        <div className="m-empty">
          {isEmptyPending
            ? 'Every expense in this batch has been rejected. Closing it will reject the whole settlement.'
            : 'No expenses in this settlement.'}
        </div>
      )}

      {settlement.expenses.map((e) => {
        const reviewed = isReviewed(e);
        const selectable = isSelectable(e);
        const selected = selectable && selectedIds.has(e.id);
        const busy = busyId === e.id;
        return (
          <div key={e.id} className="m-item" style={{ ['--tone' as string]: reviewed ? 'var(--success)' : 'var(--warning)', opacity: selectMode && !selectable ? 0.55 : 1 }}>
            <Link
              href={`/expenses/${e.id}`}
              style={{ display: 'flex', gap: 10, textDecoration: 'none', color: 'inherit' }}
              onClick={(ev) => {
                if (!selectMode) return;
                ev.preventDefault();
                toggleSelected(e);
              }}
            >
              {selectMode && (
                <input
                  type="checkbox"
                  style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                  checked={selected}
                  disabled={!selectable}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={() => toggleSelected(e)}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-item-row">
                  <span className="m-item-title">{e.expenseNo}</span>
                  <span className="m-item-amount">{formatCurrency(e.amount)}</span>
                </div>
                <div className="m-item-meta">
                  {e.sales?.name}
                  <br />
                  {e.advertiser?.name} / {e.brand?.name} · {e.purpose}
                </div>
                <div className="m-item-foot">
                  <StatusBadge status={e.status} />
                  {reviewed && <span className="badge badge-success">Reviewed</span>}
                </div>
              </div>
            </Link>
            {!selectMode && canAct && !reviewed && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-approve" style={{ flex: 1 }} disabled={busy} onClick={() => act(e, 'approve')}>
                  Approve
                </button>
                <button className="btn btn-reject" style={{ flex: 1 }} disabled={busy} onClick={() => setRejecting(e)}>
                  Reject
                </button>
              </div>
            )}
          </div>
        );
      })}

      {selectMode && selectedIds.size > 0 && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(76px + env(safe-area-inset-bottom))',
            padding: '10px 16px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            zIndex: 25,
          }}
        >
          <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-reject" style={{ flex: 1 }} disabled={bulkBusy} onClick={() => setBulkRejecting(true)}>
              Reject
            </button>
            <button className="btn btn-approve" style={{ flex: 1 }} disabled={bulkBusy} onClick={bulkApprove}>
              {bulkBusy ? 'Processing...' : `Approve (${selectedIds.size})`}
            </button>
          </div>
        </div>
      )}

      {!selectMode && canAct && allReviewed && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(76px + env(safe-area-inset-bottom))',
            padding: '10px 16px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            zIndex: 25,
          }}
        >
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <button className="btn btn-approve" style={{ width: '100%' }} disabled={submitBusy} onClick={submitTier}>
              {submitBusy ? 'Submitting...' : 'Submit tier'}
            </button>
          </div>
        </div>
      )}

      {/* Zero expenses left is not a normal tier submit - it REJECTs the whole
          Settlement, so it gets its own button + confirm sheet rather than
          reusing "Submit tier" or firing on its own from refresh(). */}
      {!selectMode && isEmptyPending && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(76px + env(safe-area-inset-bottom))',
            padding: '10px 16px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            zIndex: 25,
          }}
        >
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <button className="btn btn-danger" style={{ width: '100%' }} onClick={() => setCloseConfirming(true)}>
              Close settlement (reject)
            </button>
          </div>
        </div>
      )}

      {closeConfirming && (
        <div className="m-sheet-backdrop" role="dialog" aria-modal="true" onClick={() => !submitBusy && setCloseConfirming(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>Reject settlement {settlement.settlementNo}?</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>
              Every expense in this batch was rejected. Closing it now permanently marks the whole settlement as REJECTED. This cannot be undone.
            </p>
            {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} disabled={submitBusy} onClick={() => setCloseConfirming(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" style={{ flex: 1 }} disabled={submitBusy} onClick={submitTier}>
                {submitBusy ? 'Closing...' : 'Reject settlement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkRejecting && (
        <div
          className="m-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => !bulkBusy && !bulkReason.trim() && setBulkRejecting(false)}
        >
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>Reject {selectedIds.size} expense(s) - reason</h3>
            {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
            <textarea ref={bulkRejectTextareaRef} value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} rows={3} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Minimum 3 characters</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} disabled={bulkBusy} onClick={() => setBulkRejecting(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" style={{ flex: 1 }} disabled={bulkReason.trim().length < 3 || bulkBusy} onClick={bulkReject}>
                {bulkBusy ? 'Processing...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revising && (
        <div
          className="m-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => !submitBusy && !reviseReason.trim() && setRevising(false)}
        >
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>Revise reason (send back one tier)</h3>
            {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
            <textarea ref={reviseTextareaRef} value={reviseReason} onChange={(e) => setReviseReason(e.target.value)} rows={3} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Minimum 3 characters</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} disabled={submitBusy} onClick={() => setRevising(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                style={{ flex: 1 }}
                disabled={reviseReason.trim().length < 3 || submitBusy}
                onClick={reviseTier}
              >
                {submitBusy ? 'Processing...' : 'Revise'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejecting && (
        <div
          className="m-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => !reason.trim() && closeReject()}
        >
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>Reject reason</h3>
            {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
            <textarea ref={rejectTextareaRef} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Minimum 3 characters</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={closeReject}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                style={{ flex: 1 }}
                disabled={reason.trim().length < 3 || busyId === rejecting.id}
                onClick={() => act(rejecting, 'reject', { reason: reason.trim() })}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
