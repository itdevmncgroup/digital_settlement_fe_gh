'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import {
  clientLabel,
  currentApprovalStep,
  EXPENSE_REQUEST_STATUS_LABEL,
  expenseRequestTone,
  ExpenseRequest,
  POSITION_CORSEC,
  POSITION_SALES_CS,
  stepDisplayStatus,
} from '@/lib/expenseRequests';
import NumberInput from '@/components/NumberInput';
import { formatCurrency, SkeletonList } from '@/lib/mobileUi';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

// Detail of one Expense Request. No GET /expense-requests/:id exists, so it's
// found in the (already access-scoped) list. Approve/Reject shows only when it
// is the user's own approval step (or ADMIN), or the Corsec verification stage
// and the user is Corsec (or ADMIN) - same rules as the desktop page.
export default function MobileExpenseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, hasRole } = useAuth();
  const [request, setRequest] = useState<ExpenseRequest | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Budget stage: "Input Budget" fills these in a sheet; "Submit" sends them.
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetNotes, setBudgetNotes] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);

  // Delay past the m-sheet-up animation so the iOS keyboard doesn't fight it (see /m/approvals).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!rejecting) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [rejecting]);

  const load = () => {
    api
      .get<ExpenseRequest[]>('/expense-requests')
      .then((all) => {
        const found = all.find((r) => r.id === id);
        setRequest(found ?? null);
        setNotFound(!found);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };
  useEffect(load, [id]);

  const isAdmin = hasRole('ADMINISTRATOR');
  const step = request ? currentApprovalStep(request) : undefined;
  const verifying = request?.status === 'CORSEC_VERIFICATION';
  const canAct = verifying
    ? user?.position?.code === POSITION_CORSEC || isAdmin
    : !!step && (step.resolvedApprover?.id === user?.id || isAdmin);

  // A DRAFT is still editable, and can be submitted, by whoever entered it.
  const canEditDraft = request?.status === 'DRAFT' && (request.requestedBy?.id === user?.id || request.createdBy?.id === user?.id || isAdmin);

  // Budget stage: Sales Customer Service (or ADMIN) fills the budget; submitting moves it on to Corsec.
  const canFillBudget = request?.status === 'BUDGET_INPUT' && (user?.position?.code === POSITION_SALES_CS || isAdmin);
  const budgetReady = Number(budgetAmount) > 0;

  const submitBudget = async () => {
    if (!request || !budgetReady) return;
    setBudgetBusy(true);
    setError('');
    try {
      await api.post(`/expense-requests/${request.id}/budget`, {
        budgetAmount: Number(budgetAmount),
        budgetNotes: budgetNotes.trim() || undefined,
      });
      // Back to wherever the user came from (approval list or expense request list).
      if (window.history.length > 1) router.back();
      else router.replace('/m/expense-requests');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit budget');
    } finally {
      setBudgetBusy(false);
    }
  };

  const submitDraft = async () => {
    if (!request) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/expense-requests/${request.id}/submit`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (approve: boolean, rejectReason?: string) => {
    if (!request) return;
    setBusy(true);
    setError('');
    try {
      if (verifying) {
        await api.post(`/expense-requests/${request.id}/verify`, { decision: approve ? 'PROCEED' : 'CANCELLED', reason: rejectReason });
      } else {
        await api.post(`/approvals/expense-request/${request.id}/${approve ? 'approve' : 'reject'}`, approve ? undefined : { reason: rejectReason });
      }
      setRejecting(false);
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const tone = request ? expenseRequestTone(request.status) : 'info';

  return (
    <div style={{ paddingBottom: canAct || canEditDraft || canFillBudget ? 96 : 0 }}>
      <Link href="/m/expense-requests" style={{ fontSize: 13, textDecoration: 'none' }}>
        ‹ Request Expense
      </Link>
      {error && !rejecting && <div className="error-text">{error}</div>}
      {!request && !error && !notFound && <SkeletonList />}
      {notFound && <div className="m-empty">Expense request not found.</div>}

      {request && (
        <>
          <h1 style={{ marginBottom: 6 }}>{request.requestNo}</h1>
          <div style={{ marginBottom: 14 }}>
            <span className={`badge badge-${tone}`}>{EXPENSE_REQUEST_STATUS_LABEL[request.status]}</span>
          </div>

          <div className="card">
            <Field label="Activity Type">{request.activityType?.name}</Field>
            <Field label="Requested By">
              {request.requestedBy?.name}
              {request.department && ` · ${request.department.name}`}
            </Field>
            {request.createdBy && <Field label="Entered By">{request.createdBy.name}</Field>}
            {request.agencies?.length > 0 && <Field label="Agency">{request.agencies.map((a) => a.agency.name).join(', ')}</Field>}
            {request.advertisers?.length > 0 ? (
              <Field label="Advertiser">{request.advertisers.map((a) => a.advertiser.name).join(', ')}</Field>
            ) : (
              <Field label="Nama Client">{clientLabel(request)}</Field>
            )}
            {request.brands?.length > 0 && <Field label="Brand">{request.brands.map((b) => b.brand.name).join(', ')}</Field>}
            {request.requestBudget && <Field label="Budget">{formatCurrency(request.requestBudget)}</Field>}
            <Field label="Isi Ucapan">{request.greetingText}</Field>
            <Field label="Tanggal Kirim">{formatDate(request.sendDate)}</Field>
            {request.recipient && <Field label="Recipient">{request.recipient}</Field>}
            <Field label="Alamat Penerima">{request.recipientAddress}</Field>
            {request.logo && <Field label="Logo">{request.logo}</Field>}
            {request.budgetAmount && (
              <Field label="Budget (Sales CS)">
                {formatCurrency(request.budgetAmount)}
                {request.budgetBy && ` · by ${request.budgetBy.name}`}
                {request.budgetNotes && `\n${request.budgetNotes}`}
              </Field>
            )}
            {canFillBudget && budgetReady && (
              <Field label="Budget (to submit)">
                {formatCurrency(budgetAmount)}
                {budgetNotes.trim() && `\n${budgetNotes.trim()}`}
              </Field>
            )}
            {request.status === 'PROCEED' && request.verifiedBy && <Field label="Verified By">{request.verifiedBy.name}</Field>}
            {request.rejectReason && (
              <Field label="Reject Reason">
                <span style={{ color: 'var(--danger)' }}>{request.rejectReason}</span>
              </Field>
            )}
          </div>

          {request.approvalRequest && (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Approval Chain</div>
              {request.approvalRequest.steps.map((s) => {
                const status = stepDisplayStatus(request, s);
                return (
                  <div key={s.stepOrder} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '4px 0' }}>
                    <span>
                      {s.stepOrder + 1}. {s.position.name}
                      {s.resolvedApprover && <span style={{ color: 'var(--muted)' }}> · {s.resolvedApprover.name}</span>}
                    </span>
                    <span className={`badge badge-${status === 'APPROVED' ? 'success' : status === 'REJECTED' ? 'danger' : 'warning'}`}>{status}</span>
                  </div>
                );
              })}
            </div>
          )}

          {canEditDraft && (
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
                <Link href={`/m/expense-requests/${request.id}/edit`} className="btn" style={{ flex: 1, justifyContent: 'center', textDecoration: 'none' }}>
                  Edit
                </Link>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={submitting} onClick={submitDraft}>
                  {submitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          )}

          {canFillBudget && (
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
                <button className="btn" style={{ flex: 1 }} disabled={budgetBusy} onClick={() => setBudgetOpen(true)}>
                  {budgetReady ? 'Edit Budget' : 'Input Budget'}
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={!budgetReady || budgetBusy} onClick={submitBudget}>
                  {budgetBusy ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          )}

          {canAct && (
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
                <button className="btn btn-reject" style={{ flex: 1 }} disabled={busy} onClick={() => setRejecting(true)}>
                  {verifying ? 'Cancel' : 'Reject'}
                </button>
                <button className="btn btn-approve" style={{ flex: 1 }} disabled={busy} onClick={() => act(true)}>
                  {busy ? 'Processing...' : verifying ? 'Proceed' : 'Approve'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {budgetOpen && request && (
        <div className="m-sheet-backdrop" role="dialog" aria-modal="true" onClick={() => setBudgetOpen(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px' }}>Input Budget</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              {request.requestNo} · {clientLabel(request)}
            </div>
            <div className="form-row">
              <label>Budget (IDR) *</label>
              <NumberInput inputMode="numeric" value={budgetAmount} onChange={setBudgetAmount} placeholder="0" />
            </div>
            <div className="form-row">
              <label>Reason / Notes (optional)</label>
              <textarea rows={3} value={budgetNotes} onChange={(e) => setBudgetNotes(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setBudgetOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={!budgetReady} onClick={() => setBudgetOpen(false)}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="m-sheet-backdrop" role="dialog" aria-modal="true" onClick={() => !busy && !reason.trim() && setRejecting(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>{verifying ? 'Cancel reason' : 'Reject reason'}</h3>
            {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
            <textarea ref={textareaRef} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Minimum 3 characters</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => setRejecting(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" style={{ flex: 1 }} disabled={reason.trim().length < 3 || busy} onClick={() => act(false, reason.trim())}>
                {busy ? 'Processing...' : verifying ? 'Cancel' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
