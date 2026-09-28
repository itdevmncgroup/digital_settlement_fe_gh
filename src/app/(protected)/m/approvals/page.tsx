'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import { formatCurrency, SkeletonList } from '@/lib/mobileUi';

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
  advertiser: { name: string };
  brand: { name: string };
}

interface StepInfo {
  stepOrder: number;
  position: { name: string };
  resolvedApprover?: { id: string; name: string };
}

interface SettlementSummary {
  id: string;
  settlementNo: string;
  totalAmount: string;
  department: { name: string };
  createdBy: { name: string };
  expenses: { id: string }[];
}

interface PendingApproval {
  id: string;
  documentStage: 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT';
  currentStep: number;
  // Actor-relative: true only when it is this user's own step right now.
  isMyTurn?: boolean;
  steps: StepInfo[];
  expense: DocSummary | null;
  event: DocSummary | null;
  settlement: SettlementSummary | null;
}

const STAGE_LABEL = { PRE_EVENT: 'Pre-Event', EXPENSES: 'Expenses', SETTLEMENT: 'Settlement' } as const;

export default function MobileApprovalsPage() {
  const { user, hasRole } = useAuth();
  const [rows, setRows] = useState<PendingApproval[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  const [reason, setReason] = useState('');

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkRejecting, setBulkRejecting] = useState(false);

  // Focusing the moment the sheet mounts races the m-sheet-up slide-in
  // animation (0.22s) - on iOS Safari the keyboard opens mid-animation and
  // the sheet often ends up rendered behind it. Delaying past the animation
  // avoids that.
  const rejectTextareaRef = useRef<HTMLTextAreaElement>(null);
  const bulkRejectTextareaRef = useRef<HTMLTextAreaElement>(null);
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

  const load = () => {
    api
      .get<PendingApproval[]>('/approvals/pending')
      // The API also returns look-ahead rows (later steps, read-scope) - only what
      // needs this user's approval right now belongs here, matching the dashboard count.
      .then((all) => setRows(all.filter((r) => r.isMyTurn || hasRole('ADMINISTRATOR'))))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };
  useEffect(load, []);

  // Same rule as the desktop inbox: only the step's resolved approver (or ADMIN) gets buttons.
  const canActOn = (step: StepInfo | undefined) => !!step && (step.resolvedApprover?.id === user?.id || hasRole('ADMINISTRATOR'));

  // Bulk selection is Expense-only, same restriction as the desktop inbox and
  // the mobile app (ApprovalsListScreen._selectable) - Pre-Event/Settlement
  // rows still go through their own single action.
  const isSelectable = (r: PendingApproval) => !!r.expense && canActOn(r.steps.find((s) => s.stepOrder === r.currentStep));

  const act = async (r: PendingApproval, action: 'approve' | 'reject', body?: { reason: string }) => {
    setBusyId(r.id);
    setError('');
    try {
      const kind = r.expense ? 'expense' : 'event';
      await api.post(`/approvals/${kind}/${(r.expense ?? r.event)!.id}/${action}`, body);
      closeReject();
      load();
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

  const toggleSelected = (r: PendingApproval) => {
    if (!isSelectable(r)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(r.expense!.id)) next.delete(r.expense!.id);
      else next.add(r.expense!.id);
      return next;
    });
  };

  const selectableRows = (rows ?? []).filter(isSelectable);
  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === selectableRows.length ? new Set() : new Set(selectableRows.map((r) => r.expense!.id))));
  };

  // Backend has no batch approve/reject endpoint - each selected expense fires
  // its own call, one at a time so one failure doesn't fire a burst of
  // retries; failures are collected and reported together instead of
  // aborting the whole batch. Same pattern as the desktop inbox / mobile app.
  const runBulk = async (call: (id: string) => Promise<unknown>) => {
    const ids = Array.from(selectedIds);
    // expenseNo per id, captured before the batch runs - by the time a
    // failure is reported, load() may have already dropped/reordered rows.
    const labelById = new Map((rows ?? []).filter((r) => r.expense).map((r) => [r.expense!.id, r.expense!.expenseNo ?? r.expense!.id]));
    setBulkBusy(true);
    let success = 0;
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await call(id);
        success++;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed';
        failures.push(`${labelById.get(id) ?? id}: ${message}`);
      }
    }
    setBulkBusy(false);
    setBulkRejecting(false);
    setBulkReason('');
    setSelectMode(false);
    setSelectedIds(new Set());
    setError(failures.length === 0 ? '' : `${success} succeeded, ${failures.length} failed - ${failures.join('; ')}`);
    load();
  };

  const bulkApprove = () => runBulk((id) => api.post(`/approvals/expense/${id}/approve`));
  const bulkReject = () => runBulk((id) => api.post(`/approvals/expense/${id}/reject`, { reason: bulkReason.trim() }));

  // A row with none of settlement/expense/event set renders nothing (see the
  // `if (!doc) return null` guard below) - excluded here too so the "N
  // waiting" count and the empty state agree with what's actually on screen.
  const visibleRows = (rows ?? []).filter((r) => r.settlement || r.expense || r.event);

  return (
    <div style={{ paddingBottom: selectMode && selectedIds.size > 0 ? 96 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>{selectMode ? `${selectedIds.size} selected` : 'Approval'}</h1>
        {rows && selectableRows.length > 0 && (
          <button className="btn" style={{ minHeight: 36 }} disabled={bulkBusy} onClick={toggleSelectMode}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>
      {rows && visibleRows.length > 0 && !selectMode && <div className="m-subtitle">{visibleRows.length} waiting</div>}
      {error && (
        <div className="error-text" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <span>{error}</span>
          {!rows && (
            <button className="btn" style={{ minHeight: 30 }} onClick={load}>
              Retry
            </button>
          )}
        </div>
      )}
      {!rows && !error && <SkeletonList />}
      {rows && visibleRows.length === 0 && <div className="m-empty">Nothing pending your approval 🎉</div>}

      {selectMode && selectableRows.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '4px 2px 12px' }}>
          <input
            type="checkbox"
            style={{ width: 18, height: 18 }}
            checked={selectedIds.size === selectableRows.length}
            onChange={toggleSelectAll}
          />
          Select all ({selectableRows.length})
        </label>
      )}

      {visibleRows.map((r) => {
        if (r.settlement) {
          const s = r.settlement;
          const step = r.steps.find((st) => st.stepOrder === r.currentStep);
          return (
            <Link
              key={r.id}
              href={`/m/approvals/settlement/${s.id}`}
              className="m-item"
              style={{ ['--tone' as string]: 'var(--warning)', display: 'block', textDecoration: 'none', color: 'inherit', opacity: selectMode ? 0.55 : 1, pointerEvents: selectMode ? 'none' : 'auto' }}
            >
              <div className="m-item-row">
                <span className="m-item-title">{s.settlementNo}</span>
                <span className="m-item-amount">{formatCurrency(s.totalAmount ?? 0)}</span>
              </div>
              <div className="m-item-meta">
                {s.createdBy?.name} · {s.department?.name}
              </div>
              <div className="m-item-foot">
                <span className="badge badge-info">{STAGE_LABEL[r.documentStage] ?? r.documentStage}</span>
                <span>
                  Step {r.currentStep + 1}/{r.steps.length} · {step?.position.name ?? '-'}
                </span>
                <span style={{ marginLeft: 'auto' }}>{s.expenses.length} expense(s) ›</span>
              </div>
            </Link>
          );
        }
        const doc = r.expense ?? r.event;
        if (!doc) return null;
        const href = r.expense ? `/expenses/${doc.id}` : `/events/${doc.id}`;
        const step = r.steps.find((s) => s.stepOrder === r.currentStep);
        const busy = busyId === r.id;
        const selectable = isSelectable(r);
        const selected = selectable && selectedIds.has(r.expense!.id);
        return (
          <div key={r.id} className="m-item" style={{ ['--tone' as string]: 'var(--warning)', opacity: selectMode && !selectable ? 0.55 : 1 }}>
            <Link
              href={href}
              style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 10 }}
              onClick={(e) => {
                if (!selectMode) return;
                e.preventDefault();
                toggleSelected(r);
              }}
            >
              {selectMode && (
                <input
                  type="checkbox"
                  style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                  checked={selected}
                  disabled={!selectable}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelected(r)}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-item-row">
                  <span className="m-item-title">{r.expense ? doc.expenseNo : doc.eventNo}</span>
                  <span className="m-item-amount">{formatCurrency((r.expense ? doc.amount : doc.estimatedAmount) ?? 0)}</span>
                </div>
                <div className="m-item-meta">
                  {doc.sales?.name} · {doc.unit?.name}
                  <br />
                  {doc.advertiser?.name} / {doc.brand?.name} · {formatDate(r.expense ? doc.expenseDate : doc.date)}
                </div>
                <div className="m-item-foot">
                  <span className="badge badge-info">{STAGE_LABEL[r.documentStage] ?? r.documentStage}</span>
                  <span>
                    Step {r.currentStep + 1}/{r.steps.length} · {step?.position.name ?? '-'}
                  </span>
                </div>
              </div>
            </Link>
            {!selectMode && canActOn(step) && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-approve" style={{ flex: 1 }} disabled={busy} onClick={() => act(r, 'approve')}>
                  Approve
                </button>
                <button className="btn btn-reject" style={{ flex: 1 }} disabled={busy} onClick={() => setRejecting(r)}>
                  Reject
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Anchored above the floating bottom-nav pill (mobile.css .bottom-nav),
          same convention as the New Expense Submit bar. */}
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

      {bulkRejecting && (
        <div
          className="m-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          // A typed-out reason is real work in progress - only let a stray
          // backdrop tap dismiss the sheet when there's nothing to lose.
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
