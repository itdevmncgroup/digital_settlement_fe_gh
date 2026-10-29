'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import WebMobileGate from '@/components/WebMobileGate';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import { clientLabel, POSITION_SALES_CS } from '@/lib/expenseRequests';
import { formatCurrency, SkeletonList } from '@/lib/mobileUi';
import { MATCH_FIRST_MESSAGE, mustMatchBeforeApprove } from '@/lib/expenseApproval';
import NumberInput from '@/components/NumberInput';

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
  activityType?: { name: string } | null;
  status?: string;
  isMatched?: boolean;
}

interface StepInfo {
  stepOrder: number;
  position: { name: string; code?: string };
  resolvedApprover?: { id: string; name: string };
}

interface SettlementSummary {
  id: string;
  settlementNo: string;
  totalAmount: string;
  department: { name: string };
  createdBy: { name: string };
  expenses: { id: string; activityType?: { name: string } | null }[];
}

// A Settlement batches Expenses that may differ in Activity Type - list each one once.
function settlementActivityTypes(s: SettlementSummary): string {
  return Array.from(new Set(s.expenses.map((e) => e.activityType?.name).filter((n): n is string => !!n))).join(', ');
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

// Expense Request (Flower Bouquet) is a separate flow: GET /approvals/pending
// leaves it out, so it comes from GET /expense-requests instead (same shape as
// the desktop /expense-requests page).
interface ExpenseRequestRow {
  id: string;
  requestNo: string;
  requestedBy: { name: string };
  department: { id: string; name: string } | null;
  activityType: { name: string };
  clientName: string | null;
  advertisers?: { advertiser: { name: string } }[];
  greetingText: string;
  sendDate: string;
  recipient: string | null;
  recipientAddress: string;
  status: 'PENDING_APPROVAL' | 'BUDGET_INPUT' | 'CORSEC_VERIFICATION' | 'PROCEED' | 'REJECTED' | 'CANCELLED';
  approvalRequest: { currentStep: number; status: string; steps: (StepInfo & { status: string })[] } | null;
}

// Position code of the final Corsec verification stage (see BE seed).
const POSITION_CORSEC = 'CORSEC';

type RequestAction = 'approve' | 'reject' | 'verify-approve' | 'verify-reject';

// Document-type groups that support bulk approve/reject. Settlement is
// deliberately absent: its tier can only advance after the approver reviews
// every member Expense individually (submitSettlementTier), so there is no
// bulk path for it.
type SelectGroup = 'request' | 'expense';

export default function MobileApprovalsPage() {
  return (
    <WebMobileGate permissions={['webmobile.approval.read.own', 'webmobile.approval.read.owndept']}>
      <MobileApprovalsList />
    </WebMobileGate>
  );
}

function MobileApprovalsList() {
  const { user, hasRole, hasPermission } = useAuth();
  // webmobile.approval.read.own: only what waits on this user right now. .read.owndept also lists
  // what waits on other approvers of the user's Department(s) - read-only, the Approve/Reject
  // buttons stay with the step's resolved approver (or ADMIN).
  const seeDept = hasRole('ADMINISTRATOR') || hasPermission('webmobile.approval.read.owndept');
  const [rows, setRows] = useState<PendingApproval[] | null>(null);
  const [requests, setRequests] = useState<ExpenseRequestRow[]>([]);
  const [departmentIds, setDepartmentIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState<{ row: ExpenseRequestRow; verify: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [revising, setRevising] = useState<PendingApproval | null>(null);
  const [reviseReason, setReviseReason] = useState('');
  const [budgetFor, setBudgetFor] = useState<ExpenseRequestRow | null>(null);
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetNotes, setBudgetNotes] = useState('');

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bulk selection is locked to one document-type group at a time; null while nothing is selected.
  const [selectedGroup, setSelectedGroup] = useState<SelectGroup | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkRejecting, setBulkRejecting] = useState(false);

  // Focusing the moment the sheet mounts races the m-sheet-up slide-in
  // animation (0.22s) - on iOS Safari the keyboard opens mid-animation and
  // the sheet often ends up rendered behind it. Delaying past the animation
  // avoids that.
  const rejectTextareaRef = useRef<HTMLTextAreaElement>(null);
  const bulkRejectTextareaRef = useRef<HTMLTextAreaElement>(null);
  const reviseTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rejectSheetOpen = !!rejecting || !!rejectingRequest;
  useEffect(() => {
    if (!rejectSheetOpen) return;
    const t = setTimeout(() => rejectTextareaRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [rejectSheetOpen]);
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

  const load = () => {
    api
      .get<PendingApproval[]>('/approvals/pending')
      // The API also returns look-ahead rows (later steps, read-scope) - without
      // webmobile.approval.read.owndept only what needs this user's approval right now
      // belongs here, matching the dashboard count. Even with it, a document whose
      // approver chain does not include this user is not theirs to approve - hidden.
      .then((all) => setRows(all.filter((r) => r.isMyTurn || (seeDept && isInChain(r.steps)))))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    if (seeDept) {
      // Best-effort: only used to pick the Expense Requests of the user's own Department(s).
      api
        .get<{ id: string }[]>('/departments/me')
        .then((ds) => setDepartmentIds(new Set(ds.map((d) => d.id))))
        .catch(() => undefined);
    }
    // Best-effort: a failure here must not hide the main approval list. Filtered
    // to what needs this user at render time (user may not be loaded yet here).
    api
      .get<ExpenseRequestRow[]>('/expense-requests')
      .then(setRequests)
      .catch(() => setRequests([]));
  };
  useEffect(load, []);

  const isAdmin = hasRole('ADMINISTRATOR');
  const requestStep = (r: ExpenseRequestRow) => {
    const ar = r.approvalRequest;
    if (r.status !== 'PENDING_APPROVAL' || !ar || ar.status !== 'PENDING') return undefined;
    return ar.steps.find((s) => s.stepOrder === ar.currentStep);
  };
  // Approval step is the user's (or ADMIN), the budget stage and the user is Sales Customer Service (or ADMIN),
  // or the Corsec verification stage and the user is Corsec (or ADMIN).
  const needsMyAction = (r: ExpenseRequestRow) => {
    if (r.status === 'BUDGET_INPUT') return user?.position?.code === POSITION_SALES_CS || isAdmin;
    if (r.status === 'CORSEC_VERIFICATION') return user?.position?.code === POSITION_CORSEC || isAdmin;
    const step = requestStep(r);
    return !!step && (step.resolvedApprover?.id === user?.id || isAdmin);
  };
  // Whether this user holds (or, as ADMIN, may act on) any tier of the document's approver chain.
  const isInChain = (steps: StepInfo[]) => isAdmin || steps.some((s) => s.resolvedApprover?.id === user?.id);
  // Expense Request: its Sales CS (budget) and Corsec (verify) stages are Position-gated, not part of `steps`.
  const isRequestApprover = (r: ExpenseRequestRow) =>
    isInChain(r.approvalRequest?.steps ?? []) || user?.position?.code === POSITION_SALES_CS || user?.position?.code === POSITION_CORSEC;
  const waitingInMyDept = (r: ExpenseRequestRow) =>
    seeDept &&
    isRequestApprover(r) &&
    !!r.department &&
    departmentIds.has(r.department.id) &&
    (r.status === 'PENDING_APPROVAL' || r.status === 'BUDGET_INPUT' || r.status === 'CORSEC_VERIFICATION');
  const myRequests = requests.filter((r) => needsMyAction(r) || waitingInMyDept(r));

  const postRequestAction = (r: ExpenseRequestRow, action: RequestAction, body?: { reason: string }) =>
    action === 'approve' || action === 'reject'
      ? api.post(`/approvals/expense-request/${r.id}/${action}`, body)
      : api.post(`/expense-requests/${r.id}/verify`, {
          decision: action === 'verify-approve' ? 'PROCEED' : 'CANCELLED',
          reason: body?.reason,
        });

  const actOnRequest = async (r: ExpenseRequestRow, action: RequestAction, body?: { reason: string }) => {
    setBusyId(r.id);
    setError('');
    try {
      await postRequestAction(r, action, body);
      closeReject();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusyId('');
    }
  };

  const closeBudget = () => {
    setBudgetFor(null);
    setBudgetAmount('');
    setBudgetNotes('');
  };

  // Sales Customer Service fills the budget; the request then moves on to Corsec verification.
  const submitBudget = async () => {
    if (!budgetFor || !(Number(budgetAmount) > 0)) return;
    setBusyId(budgetFor.id);
    setError('');
    try {
      await api.post(`/expense-requests/${budgetFor.id}/budget`, {
        budgetAmount: Number(budgetAmount),
        budgetNotes: budgetNotes.trim() || undefined,
      });
      closeBudget();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit budget');
    } finally {
      setBusyId('');
    }
  };

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
    setRejectingRequest(null);
    setReason('');
  };

  // Revise is Expense-chain only (see ApprovalsController's
  // expense/:expenseId/revise route) - sends the Expense back one tier
  // instead of rejecting it outright.
  const reviseExpense = async () => {
    if (!revising?.expense) return;
    setBusyId(revising.id);
    setError('');
    try {
      await api.post(`/approvals/expense/${revising.expense.id}/revise`, { reason: reviseReason.trim() });
      closeRevise();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revise failed');
    } finally {
      setBusyId('');
    }
  };
  const closeRevise = () => {
    setRevising(null);
    setReviseReason('');
  };

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setSelectedGroup(null);
  };

  // A group other than the one currently holding a selection is locked.
  const groupLocked = (group: SelectGroup) => selectedGroup !== null && selectedGroup !== group;

  const toggleSelected = (group: SelectGroup, id: string) => {
    if (groupLocked(group)) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    setSelectedGroup(next.size > 0 ? group : null);
  };

  const toggleSelectAll = (group: SelectGroup, ids: string[]) => {
    if (groupLocked(group)) return;
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(ids));
    setSelectedGroup(allSelected ? null : group);
  };

  // A row with none of settlement/expense/event set renders nothing (see the
  // `if (!doc) return null` guard below) - excluded here too so the "N
  // waiting" count and the empty state agree with what's actually on screen.
  const visibleRows = (rows ?? []).filter((r) => r.settlement || r.expense || r.event);
  const totalWaiting = visibleRows.length + myRequests.length;

  const requestRows = myRequests;
  const expenseRows = visibleRows.filter((r) => !r.settlement);
  const settlementRows = visibleRows.filter((r) => r.settlement);

  // "Input Budget" has no approve/reject, so it never takes part in bulk selection.
  const isRequestSelectable = (r: ExpenseRequestRow) => r.status !== 'BUDGET_INPUT' && needsMyAction(r);
  const selectableRequests = requestRows.filter(isRequestSelectable);
  const selectableRows = expenseRows.filter(isSelectable);
  const requestIds = selectableRequests.map((r) => r.id);
  const expenseIds = selectableRows.map((r) => r.expense!.id);

  // Backend has no batch approve/reject endpoint - each selected document fires
  // its own call, one at a time so one failure doesn't fire a burst of
  // retries; failures are collected and reported together instead of
  // aborting the whole batch. Same pattern as the desktop inbox / mobile app.
  const runBulk = async (action: 'approve' | 'reject') => {
    const reason = bulkReason.trim();
    // Labels/calls captured before the batch runs - by the time a failure is
    // reported, load() may have already dropped/reordered rows.
    const targets: { label: string; call: () => Promise<unknown> }[] =
      selectedGroup === 'request'
        ? selectableRequests
            .filter((r) => selectedIds.has(r.id))
            .map((r) => {
              const verifying = r.status === 'CORSEC_VERIFICATION';
              const kind: RequestAction = verifying ? (action === 'approve' ? 'verify-approve' : 'verify-reject') : action;
              return { label: r.requestNo, call: () => postRequestAction(r, kind, action === 'reject' ? { reason } : undefined) };
            })
        : selectableRows
            .filter((r) => selectedIds.has(r.expense!.id))
            .map((r) => ({
              label: r.expense!.expenseNo ?? r.expense!.id,
              // Flower Bouquet at the Sales Admin tier must be matched first - reported as a per-row failure.
              call: () =>
                action === 'approve' && mustMatchBeforeApprove(r.expense, r.steps.find((s) => s.stepOrder === r.currentStep)?.position.code)
                  ? Promise.reject(new ApiError(400, MATCH_FIRST_MESSAGE))
                  : api.post(`/approvals/expense/${r.expense!.id}/${action}`, action === 'reject' ? { reason } : undefined),
            }));
    setBulkBusy(true);
    let success = 0;
    const failures: string[] = [];
    for (const t of targets) {
      try {
        await t.call();
        success++;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed';
        failures.push(`${t.label}: ${message}`);
      }
    }
    setBulkBusy(false);
    setBulkRejecting(false);
    setBulkReason('');
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectedGroup(null);
    setError(failures.length === 0 ? '' : `${success} succeeded, ${failures.length} failed - ${failures.join('; ')}`);
    load();
  };

  const bulkApprove = () => runBulk('approve');
  const bulkReject = () => runBulk('reject');

  const groupHeader = (title: string, count: number, group?: SelectGroup, ids: string[] = []) => {
    const locked = !!group && groupLocked(group);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 2px 8px' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {title} ({count})
        </div>
        {selectMode && group && ids.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: locked ? 0.45 : 1 }}>
            <input
              type="checkbox"
              style={{ width: 18, height: 18 }}
              checked={allSelected}
              disabled={locked || bulkBusy}
              onChange={() => toggleSelectAll(group, ids)}
            />
            Select all ({ids.length})
          </label>
        )}
        {selectMode && !group && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Review inside each settlement</span>}
      </div>
    );
  };

  const renderRequest = (r: ExpenseRequestRow) => {
    const selectable = isRequestSelectable(r);
    const locked = groupLocked('request');
    const selected = selectable && selectedIds.has(r.id);
    const budgetStage = r.status === 'BUDGET_INPUT';
    const step = requestStep(r);
    const verifying = r.status === 'CORSEC_VERIFICATION';
    const busy = busyId === r.id;
    const dimmed = selectMode && (!selectable || locked);
    return (
      <div key={r.id} className="m-item" style={{ ['--tone' as string]: 'var(--warning)', opacity: dimmed ? 0.55 : 1 }}>
        <Link
          href={`/m/expense-requests/${r.id}`}
          style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 10 }}
          onClick={(e) => {
            if (!selectMode) return;
            e.preventDefault();
            if (selectable) toggleSelected('request', r.id);
          }}
        >
          {selectMode && (
            <input
              type="checkbox"
              style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
              checked={selected}
              disabled={!selectable || locked || bulkBusy}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleSelected('request', r.id)}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="m-item-row">
              <span className="m-item-title">{r.requestNo}</span>
              <span className="m-item-amount">{r.activityType?.name}</span>
            </div>
            <div className="m-item-meta">
              {r.requestedBy?.name}
              {r.department && ` · ${r.department.name}`}
              <br />
              {clientLabel(r)} · {formatDate(r.sendDate)}
              <br />
              “{r.greetingText}”
              <br />
              {r.recipient && `${r.recipient} · `}
              {r.recipientAddress}
            </div>
            <div className="m-item-foot">
              <span className="badge badge-info">Expense Request</span>
              <span>
                {budgetStage
                  ? 'Waiting budget'
                  : verifying
                    ? 'Corsec verification'
                    : `Step ${(step?.stepOrder ?? 0) + 1}/${r.approvalRequest?.steps.length ?? 1} · ${step?.position.name ?? '-'}`}
              </span>
            </div>
          </div>
        </Link>
        {!selectMode &&
          needsMyAction(r) &&
          (budgetStage ? (
            // Budget stage has no approve/reject: "Input Budget" opens a popup instead.
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={() => setBudgetFor(r)}>
              Input Budget
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-approve" style={{ flex: 1 }} disabled={busy} onClick={() => actOnRequest(r, verifying ? 'verify-approve' : 'approve')}>
                {verifying ? 'Proceed' : 'Approve'}
              </button>
              <button className="btn btn-reject" style={{ flex: 1 }} disabled={busy} onClick={() => setRejectingRequest({ row: r, verify: verifying })}>
                {verifying ? 'Cancel' : 'Reject'}
              </button>
            </div>
          ))}
      </div>
    );
  };

  return (
    <div style={{ paddingBottom: selectMode && selectedIds.size > 0 ? 96 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>{selectMode ? `${selectedIds.size} selected` : 'Approval'}</h1>
        {rows && selectableRows.length + selectableRequests.length > 0 && (
          <button className="btn" style={{ minHeight: 36 }} disabled={bulkBusy} onClick={toggleSelectMode}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>
      {rows && totalWaiting > 0 && !selectMode && <div className="m-subtitle">{totalWaiting} waiting</div>}
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
      {rows && totalWaiting === 0 && <div className="m-empty">Nothing pending your approval 🎉</div>}

      {requestRows.length > 0 && (
        <>
          {groupHeader('Expense Request', requestRows.length, 'request', requestIds)}
          {requestRows.map(renderRequest)}
        </>
      )}

      {expenseRows.length > 0 && (
        <>
          {groupHeader('Expenses', expenseRows.length, 'expense', expenseIds)}
          {expenseRows.map((r) => {
            const doc = r.expense ?? r.event;
            if (!doc) return null;
            // No mobile Pre-Event page: an Event row is not a link.
            const href = r.expense ? `/m/expenses/${doc.id}` : '#';
            const step = r.steps.find((s) => s.stepOrder === r.currentStep);
            const busy = busyId === r.id;
            const selectable = isSelectable(r);
            const locked = groupLocked('expense');
            const selected = selectable && selectedIds.has(r.expense!.id);
            return (
              <div key={r.id} className="m-item" style={{ ['--tone' as string]: 'var(--warning)', opacity: selectMode && (!selectable || locked) ? 0.55 : 1 }}>
                <Link
                  href={href}
                  style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 10 }}
                  onClick={(e) => {
                    if (!r.expense) return e.preventDefault();
                    if (!selectMode) return;
                    e.preventDefault();
                    if (selectable) toggleSelected('expense', r.expense!.id);
                  }}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                      checked={selected}
                      disabled={!selectable || locked || bulkBusy}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelected('expense', r.expense!.id)}
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
                      {doc.activityType?.name && (
                        <>
                          <br />
                          Activity: {doc.activityType.name}
                        </>
                      )}
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
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    <button
                      className="btn btn-approve"
                      style={{ flex: 1, minWidth: 0 }}
                      disabled={busy || mustMatchBeforeApprove(r.expense, step?.position.code)}
                      title={mustMatchBeforeApprove(r.expense, step?.position.code) ? MATCH_FIRST_MESSAGE : undefined}
                      onClick={() => act(r, 'approve')}
                    >
                      Approve
                    </button>
                    {r.expense && (
                      <button className="btn btn-revise" style={{ flex: 1, minWidth: 0 }} disabled={busy} onClick={() => setRevising(r)}>
                        Revise
                      </button>
                    )}
                    <button className="btn btn-reject" style={{ flex: 1, minWidth: 0 }} disabled={busy} onClick={() => setRejecting(r)}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {settlementRows.length > 0 && (
        <>
          {groupHeader('Settlement', settlementRows.length)}
          {settlementRows.map((r) => {
            const s = r.settlement!;
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
                  {settlementActivityTypes(s) && (
                    <>
                      <br />
                      Activity: {settlementActivityTypes(s)}
                    </>
                  )}
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
          })}
        </>
      )}

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
            <h3 style={{ margin: '0 0 10px' }}>Reject {selectedIds.size} {selectedGroup === 'request' ? 'expense request(s)' : 'expense(s)'} - reason</h3>
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

      {budgetFor && (
        <div className="m-sheet-backdrop" role="dialog" aria-modal="true" onClick={() => busyId !== budgetFor.id && !budgetAmount && !budgetNotes.trim() && closeBudget()}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px' }}>Input Budget</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              {budgetFor.requestNo} · {clientLabel(budgetFor)}
            </div>
            {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
            <div className="form-row">
              <label>Budget (IDR) *</label>
              <NumberInput inputMode="numeric" value={budgetAmount} onChange={setBudgetAmount} placeholder="0" />
            </div>
            <div className="form-row">
              <label>Reason / Notes (optional)</label>
              <textarea rows={3} value={budgetNotes} onChange={(e) => setBudgetNotes(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} disabled={busyId === budgetFor.id} onClick={closeBudget}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!(Number(budgetAmount) > 0) || busyId === budgetFor.id}
                onClick={submitBudget}
              >
                {busyId === budgetFor.id ? 'Submitting...' : 'Submit'}
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
          onClick={() => !reviseReason.trim() && closeRevise()}
        >
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>Revise reason (send back one tier)</h3>
            {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
            <textarea ref={reviseTextareaRef} value={reviseReason} onChange={(e) => setReviseReason(e.target.value)} rows={3} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Minimum 3 characters</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={closeRevise}>
                Cancel
              </button>
              <button
                className="btn btn-revise"
                style={{ flex: 1 }}
                disabled={reviseReason.trim().length < 3 || busyId === revising.id}
                onClick={reviseExpense}
              >
                Revise
              </button>
            </div>
          </div>
        </div>
      )}

      {(rejecting || rejectingRequest) && (
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
                disabled={reason.trim().length < 3 || busyId === (rejecting ?? rejectingRequest!.row).id}
                onClick={() =>
                  rejecting
                    ? act(rejecting, 'reject', { reason: reason.trim() })
                    : actOnRequest(rejectingRequest!.row, rejectingRequest!.verify ? 'verify-reject' : 'reject', { reason: reason.trim() })
                }
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
