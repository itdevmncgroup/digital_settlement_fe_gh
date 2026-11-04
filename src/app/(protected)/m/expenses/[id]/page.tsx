'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/date';
import WebMobileGate from '@/components/WebMobileGate';
import FileThumb from '@/components/FileThumb';
import FileOrCameraInput from '@/components/FileOrCameraInput';
import LocalFileThumb from '@/components/LocalFileThumb';
import { formatCurrency, SkeletonList, StatusBadge } from '@/lib/mobileUi';
import { isExpenseEditable } from '@/lib/expenseEdit';
import { MATCH_FIRST_MESSAGE, mustMatchBeforeApprove } from '@/lib/expenseApproval';

interface InvoiceFile {
  id: string;
  fileName: string;
  mimeType: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  finalMerchantName: string | null;
  finalTotal: string | null;
  files: InvoiceFile[];
}

interface PhotoRow {
  id: string;
  fileName: string;
  mimeType: string;
}

interface Expense {
  id: string;
  expenseNo: string;
  expenseDate: string;
  purpose: string;
  amount: string;
  status: string;
  salesId: string;
  expenseRequestId: string | null; // set when raised by Corsec from an Expense Request (Flower Bouquet)
  sales: { name: string };
  unit: { name: string };
  advertiser: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  activityType: { name: string };
  creditCard: { bank: string; last4: string } | null;
  paymentMethod: { name: string } | null;
  paymentMethodNote: string | null;
  merchantName: string | null;
  location: string | null;
  department: { id: string; name: string } | null;
  items: { id: string; description: string; amount: string }[];
  invoices: Invoice[];
  extraBrands: { id: string; brand: { name: string } }[];
  extraAgencies: { id: string; agency: { name: string } }[];
  extraAdvertisers: { id: string; advertiser: { name: string } }[];
  participants: { id: string; category: string; name: string; position: string | null; company: string | null }[];
  photos: PhotoRow[];
  bankTransactions: { id: string; status: string }[];
  isMatched: boolean;
  settlement: { id: string; settlementNo: string; odooSyncStatus: string; odooSyncError: string | null } | null;
}

interface TransactionSearchResult {
  id: string;
  rawDescription: string;
  amount: string;
  transactionDate: string | null;
  status: string;
  batch: { fileName: string };
}

interface ApprovalDetail {
  steps: { stepOrder: number; status: string; position: { code: string; name: string }; resolvedApprover: { id: string; name: string } | null }[];
  currentStep: number;
  status: string;
  actions: { id: string; action: string; reason: string | null; actedAt: string; actor: { name: string }; position: { name: string } | null }[];
}

const MATCHED_TXN_STATUSES = ['AUTO_MATCHED', 'MANUAL_MATCHED'];
const INVOICE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

function ActionBar({ children }: { children: ReactNode }) {
  return (
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
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', gap: 8 }}>{children}</div>
    </div>
  );
}

export default function MobileExpenseDetailPage() {
  return (
    <WebMobileGate
      permissions={[
        'webmobile.expense.read.own',
        'webmobile.expense.read.owndept',
        'webmobile.approval.read.own',
        'webmobile.approval.read.owndept',
        'webmobile.settlement.read.owndept',
      ]}
    >
      <MobileExpenseDetail />
    </WebMobileGate>
  );
}

// Mobile counterpart of the desktop Expense detail page (/expenses/[id]): view, Approve / Revise,
// Submit for Approval, invoice + Foto Kegiatan upload and Bank Matching. Editing the fields of a DRAFT
// opens the mobile Expense form; field editing of non-DRAFT Expenses stays desktop-only.
function MobileExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, hasRole, hasPermission } = useAuth();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [revising, setRevising] = useState(false);
  const [reviseReason, setReviseReason] = useState('');
  const reviseRef = useRef<HTMLTextAreaElement>(null);

  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [showPhotoForm, setShowPhotoForm] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [matchSearch, setMatchSearch] = useState('');
  const [matchResults, setMatchResults] = useState<TransactionSearchResult[] | null>(null);
  const [matching, setMatching] = useState(false);

  const load = () => {
    api
      .get<Expense>(`/expenses/${id}`)
      .then(setExpense)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api
      .get<ApprovalDetail>(`/approvals/expense/${id}`)
      .then(setApproval)
      .catch(() => setApproval(null));
  };
  useEffect(load, [id]);

  // Delay past the m-sheet-up animation so the iOS keyboard doesn't fight it (see /m/approvals).
  useEffect(() => {
    if (!revising) return;
    const t = setTimeout(() => reviseRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [revising]);

  // Same access rules as the desktop page; the backend is authoritative and 403s anything else.
  const isAdmin = hasRole('ADMINISTRATOR');
  const isOwner = expense?.salesId === user?.id;
  const locked = !expense || !isExpenseEditable(expense.status);
  const completesPendingSalesAdmin = expense?.status === 'PENDING_SALES_ADMIN' && hasRole('SALES_ADMIN');
  const canEditFields =
    !locked && (isOwner || isAdmin || completesPendingSalesAdmin || hasPermission('expense.edit.all', 'expense.edit.owndept'));
  const canUploadFiles =
    !locked &&
    (isAdmin || completesPendingSalesAdmin || hasPermission('expense.edit.all', 'expense.edit.owndept') || (isOwner && hasPermission('expense.edit.own')));
  // A Request-linked expense waiting on its Sales Admin has no chain yet; the Sales Admin acts on it
  // directly (the backend enters the chain on Approve / Revise).
  const salesAdminActsDirectly = expense?.status === 'PENDING_SALES_ADMIN' && !!expense.expenseRequestId && (hasRole('SALES_ADMIN') || isAdmin);
  const awaitingCorsecInvoice = expense?.status === 'REVISION' && !!expense.expenseRequestId;
  const currentStepInfo = approval && approval.status === 'PENDING' ? approval.steps.find((s) => s.stepOrder === approval.currentStep) : null;
  const isSalesAdminTier = currentStepInfo?.position.code === 'SLSADM' && hasRole('SALES_ADMIN');
  const canAct =
    salesAdminActsDirectly ||
    (!!currentStepInfo && !awaitingCorsecInvoice && (currentStepInfo.resolvedApprover?.id === user?.id || isAdmin || isSalesAdminTier));
  // Flower Bouquet at the Sales Admin tier: Approve stays disabled until the expense is matched.
  const approveBlocked = mustMatchBeforeApprove(expense, currentStepInfo?.position.code);
  const showSubmit = canEditFields && !canAct && (expense?.status === 'DRAFT' || expense?.status === 'PENDING_SALES_ADMIN');
  const canMatch = isAdmin || hasPermission('expense.match.all', 'expense.match.owndept');
  const matchedTxn = expense?.bankTransactions.find((t) => MATCHED_TXN_STATUSES.includes(t.status)) ?? null;
  // The mobile form only opens a DRAFT for editing (anything else is read-only there).
  const canEditDraft = expense?.status === 'DRAFT' && canEditFields;

  const run = async (fn: () => Promise<unknown>, failMsg: string, then?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      then?.();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failMsg);
    } finally {
      setBusy(false);
    }
  };

  const approve = () => run(() => api.post(`/approvals/expense/${id}/approve`), 'Approve failed');

  // Sends the expense back one approval tier; the owner edits and resubmits at that same tier.
  const revise = () =>
    run(
      () => api.post(`/approvals/expense/${id}/revise`, { reason: reviseReason.trim() }),
      'Revise failed',
      () => {
        setRevising(false);
        setReviseReason('');
      },
    );

  // Foto Kegiatan and Foto Invoice are mandatory before the expense enters the approval chain.
  const missingEvidence = () => {
    if (!expense) return null;
    if (expense.photos.length === 0) return 'Foto Kegiatan is required - upload at least one photo first.';
    if (!expense.invoices.some((inv) => inv.files.length > 0)) return 'Foto Invoice is required - upload at least one invoice first.';
    return null;
  };

  const submit = () => {
    const missing = missingEvidence();
    if (missing) return setError(missing);
    return run(() => api.post(`/expenses/${id}/submit`), 'Submit failed');
  };

  const addInvoice = () =>
    run(
      async () => {
        // Total defaults to the Expense amount, same as the desktop page.
        const invoice = await api.post<{ id: string }>(`/expenses/${id}/invoices`, { finalTotal: expense ? Number(expense.amount) : undefined });
        for (const file of invoiceFiles) await uploadFile(`/invoices/${invoice.id}/files`, file);
      },
      'Add invoice failed',
      () => {
        setInvoiceFiles([]);
        setShowInvoiceForm(false);
      },
    );

  const addInvoiceFiles = (invoiceId: string, files: File[]) =>
    run(async () => {
      for (const file of files) await uploadFile(`/invoices/${invoiceId}/files`, file);
    }, 'Upload failed');

  const uploadPhotos = () =>
    run(
      async () => {
        for (const file of photoFiles) await uploadFile(`/expenses/${id}/photos`, file);
      },
      'Upload failed',
      () => {
        setPhotoFiles([]);
        setShowPhotoForm(false);
      },
    );

  const matchAction = async (fn: () => Promise<unknown>, failMsg: string) => {
    setMatching(true);
    setError('');
    try {
      await fn();
      setShowMatchPicker(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failMsg);
    } finally {
      setMatching(false);
    }
  };

  const searchTransactions = async () => {
    setMatching(true);
    try {
      setMatchResults(await api.get<TransactionSearchResult[]>(`/bank-settlements/transactions/search?search=${encodeURIComponent(matchSearch.trim())}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed');
    } finally {
      setMatching(false);
    }
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.replace('/m/expenses');
  };

  const hasActionBar = !!expense && (canAct || showSubmit || canEditDraft);

  return (
    <div style={{ paddingBottom: hasActionBar ? 96 : 0 }}>
      <button type="button" onClick={goBack} style={{ fontSize: 13, background: 'none', border: 0, padding: 0, color: 'var(--primary)', cursor: 'pointer' }}>
        ‹ Back
      </button>
      {error && !revising && <div className="error-text">{error}</div>}
      {!expense && !error && <SkeletonList />}

      {expense && (
        <>
          <h1 style={{ marginBottom: 6 }}>{expense.expenseNo}</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            <StatusBadge status={expense.status} />
            <span className={`badge ${expense.isMatched ? 'badge-success' : 'badge-info'}`}>{expense.isMatched ? 'Matched' : 'Not Matched'}</span>
            {expense.settlement && <span className="badge badge-info">{expense.settlement.settlementNo}</span>}
            {expense.settlement && (
              <span className={`badge ${expense.settlement.odooSyncStatus === 'SENT' ? 'badge-success' : expense.settlement.odooSyncStatus === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>
                Odoo: {expense.settlement.odooSyncStatus}
              </span>
            )}
          </div>
          {expense.settlement?.odooSyncStatus === 'FAILED' && expense.settlement.odooSyncError && (
            <div className="error-text">{expense.settlement.odooSyncError}</div>
          )}

          <div className="card">
            <Field label="Sales">
              {expense.sales?.name}
              {expense.unit && ` · ${expense.unit.name}`}
            </Field>
            <Field label="Department">{expense.department?.name || '-'}</Field>
            <Field label="Activity Type">{expense.activityType?.name}</Field>
            <Field label="Date">{formatDate(expense.expenseDate)}</Field>
            <Field label="Amount">{formatCurrency(expense.amount)}</Field>
            <Field label="Purpose">{expense.purpose}</Field>
            {expense.extraAgencies.length > 0 && <Field label="Agency">{expense.extraAgencies.map((a) => a.agency.name).join(', ')}</Field>}
            <Field label="Advertiser">{[expense.advertiser?.name, ...expense.extraAdvertisers.map((a) => a.advertiser.name)].filter(Boolean).join(', ') || '-'}</Field>
            <Field label="Brand">{[expense.brand?.name, ...expense.extraBrands.map((b) => b.brand.name)].filter(Boolean).join(', ') || '-'}</Field>
            {expense.merchantName && <Field label="Merchant">{expense.merchantName}</Field>}
            {expense.location && <Field label="Location">{expense.location}</Field>}
            <Field label="Payment Method">
              {expense.paymentMethod?.name ?? '-'}
              {expense.creditCard ? ` (${expense.creditCard.bank} •••• ${expense.creditCard.last4})` : ''}
              {expense.paymentMethodNote ? ` — ${expense.paymentMethodNote}` : ''}
            </Field>
            {expense.participants.length > 0 && (
              <Field label="Participants">
                {expense.participants
                  .map((p) => `[${p.category}] ${p.name}${p.position ? ` — ${p.position}` : ''}${p.company ? ` (${p.company})` : ''}`)
                  .join('\n')}
              </Field>
            )}
            {expense.items.length > 0 && (
              <Field label="Line Items">{expense.items.map((it) => `${it.description} — ${formatCurrency(it.amount)}`).join('\n')}</Field>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong>Invoices</strong>
              {canUploadFiles && (
                <button className="btn" onClick={() => (showInvoiceForm ? (setInvoiceFiles([]), setShowInvoiceForm(false)) : setShowInvoiceForm(true))}>
                  {showInvoiceForm ? 'Cancel' : '+ Add Invoice'}
                </button>
              )}
            </div>
            {showInvoiceForm && (
              <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <FileOrCameraInput accept={INVOICE_ACCEPT} cameraTitle="Scan Invoice" disabled={busy} onFiles={(f) => setInvoiceFiles((prev) => [...prev, ...f])} />
                {invoiceFiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {invoiceFiles.map((f, i) => (
                      <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setInvoiceFiles((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                )}
                <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || invoiceFiles.length === 0} onClick={addInvoice}>
                  {busy ? 'Saving...' : 'Save Invoice'}
                </button>
              </div>
            )}
            {expense.invoices.map((inv) => (
              <div key={inv.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
                  <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
                    <strong>{inv.finalMerchantName || 'Unnamed merchant'}</strong> — {inv.invoiceNumber || 'no number'}
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>{inv.finalTotal ? formatCurrency(inv.finalTotal) : '-'}</span>
                </div>
                {inv.files.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {inv.files.map((f) => (
                      <FileThumb key={f.id} path={`/invoices/files/${f.id}/download`} fileName={f.fileName} isImage={f.mimeType.startsWith('image/')} />
                    ))}
                  </div>
                )}
                {canUploadFiles && (
                  <div style={{ marginTop: 8 }}>
                    <FileOrCameraInput accept={INVOICE_ACCEPT} cameraTitle="Scan Invoice" disabled={busy} onFiles={(f) => addInvoiceFiles(inv.id, f)} />
                  </div>
                )}
              </div>
            ))}
            {expense.invoices.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 14 }}>No invoices attached</div>}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong>Foto Kegiatan *</strong>
              {canUploadFiles && (
                <button className="btn" onClick={() => (showPhotoForm ? (setPhotoFiles([]), setShowPhotoForm(false)) : setShowPhotoForm(true))}>
                  {showPhotoForm ? 'Cancel' : '+ Add Foto'}
                </button>
              )}
            </div>
            {showPhotoForm && (
              <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <FileOrCameraInput accept="image/jpeg,image/png,image/webp" cameraTitle="Foto Kegiatan" disabled={busy} onFiles={(f) => setPhotoFiles((prev) => [...prev, ...f])} />
                {photoFiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {photoFiles.map((f, i) => (
                      <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setPhotoFiles((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                )}
                <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || photoFiles.length === 0} onClick={uploadPhotos}>
                  {busy ? 'Uploading...' : `Upload (${photoFiles.length})`}
                </button>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {expense.photos.map((p) => (
                <FileThumb key={p.id} path={`/expenses/photos/${p.id}/download`} fileName={p.fileName} isImage={p.mimeType.startsWith('image/')} />
              ))}
              {expense.photos.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 14 }}>No photos uploaded</div>}
            </div>
          </div>

          {approval && (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Approval Trail</div>
              {[...approval.steps]
                .sort((a, b) => a.stepOrder - b.stepOrder)
                .map((s) => (
                  <div key={s.stepOrder} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '4px 0' }}>
                    <span>
                      {s.stepOrder + 1}. {s.position.name}
                      {s.resolvedApprover && <span style={{ color: 'var(--muted)' }}> · {s.resolvedApprover.name}</span>}
                    </span>
                    <span className={`badge badge-${s.status === 'APPROVED' ? 'success' : s.status === 'REJECTED' ? 'danger' : 'warning'}`}>{s.status}</span>
                  </div>
                ))}
              {approval.actions.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>No actions yet</div>
              ) : (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  {approval.actions.map((a) => {
                    const tone = a.action === 'REJECT' ? 'var(--danger)' : a.action === 'APPROVE' ? 'var(--success)' : 'var(--primary)';
                    return (
                      <div key={a.id} style={{ padding: '6px 0', fontSize: 13 }}>
                        <div>
                          <strong style={{ color: tone }}>{a.action}</strong>
                          {a.position?.name && <span style={{ color: 'var(--muted)' }}> · {a.position.name}</span>}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                          by {a.actor?.name} · {formatDateTime(a.actedAt)}
                        </div>
                        {a.reason && <div style={{ marginTop: 2, wordBreak: 'break-word' }}>{a.reason}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canMatch && (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Bank Matching</div>
              {matchedTxn ? (
                <>
                  <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>Linked to a billing statement transaction.</div>
                  <button className="btn btn-danger" disabled={matching} onClick={() => matchAction(() => api.post(`/bank-settlements/transactions/${matchedTxn.id}/unmatch`), 'Unmatch failed')}>
                    Unmatch
                  </button>
                </>
              ) : expense.isMatched ? (
                <>
                  <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>Manually matched - no billing statement transaction.</div>
                  <button className="btn btn-danger" disabled={matching} onClick={() => matchAction(() => api.post(`/bank-settlements/expenses/${id}/manual-unmatch`), 'Unmatch failed')}>
                    Unmatch
                  </button>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>
                    Link this expense to a statement line, or mark it matched directly if it won&apos;t appear on any statement (e-wallet, personal cash).
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-success"
                      style={{ flex: 1 }}
                      disabled={matching}
                      onClick={() => {
                        setMatchSearch('');
                        setMatchResults(null);
                        setShowMatchPicker(true);
                      }}
                    >
                      Link to statement
                    </button>
                    <button className="btn" style={{ flex: 1 }} disabled={matching} onClick={() => matchAction(() => api.post(`/bank-settlements/expenses/${id}/manual-match`), 'Match failed')}>
                      No statement
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {canAct ? (
            <ActionBar>
              <button className="btn btn-revise" style={{ flex: 1 }} disabled={busy} onClick={() => setRevising(true)}>
                Revise
              </button>
              <button
                className="btn btn-approve"
                style={{ flex: 1 }}
                disabled={busy || approveBlocked}
                title={approveBlocked ? MATCH_FIRST_MESSAGE : undefined}
                onClick={approve}
              >
                {busy ? 'Processing...' : 'Approve'}
              </button>
            </ActionBar>
          ) : showSubmit || canEditDraft ? (
            <ActionBar>
              {canEditDraft && (
                <Link href={`/m/expense/${expense.id}/edit`} className="btn" style={{ flex: 1, justifyContent: 'center', textDecoration: 'none' }}>
                  Edit
                </Link>
              )}
              {showSubmit && (
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={submit}>
                  {busy ? 'Submitting...' : 'Submit for Approval'}
                </button>
              )}
            </ActionBar>
          ) : null}
        </>
      )}

      {revising && (
        <div className="m-sheet-backdrop" role="dialog" aria-modal="true" onClick={() => !busy && !reviseReason.trim() && setRevising(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px' }}>Revise reason</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Sends the expense back one approval tier.</div>
            {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
            <textarea ref={reviseRef} value={reviseReason} onChange={(e) => setReviseReason(e.target.value)} rows={3} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Minimum 3 characters</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => setRevising(false)}>
                Cancel
              </button>
              <button className="btn btn-revise" style={{ flex: 1 }} disabled={reviseReason.trim().length < 3 || busy} onClick={revise}>
                {busy ? 'Processing...' : 'Revise'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMatchPicker && (
        <div className="m-sheet-backdrop" role="dialog" aria-modal="true" onClick={() => setShowMatchPicker(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>Link to statement</h3>
            <form
              className="m-search"
              onSubmit={(e) => {
                e.preventDefault();
                searchTransactions();
              }}
            >
              <input type="search" value={matchSearch} onChange={(e) => setMatchSearch(e.target.value)} placeholder="Search transaction description..." />
              <button className="btn btn-primary" type="submit" disabled={matching}>
                Search
              </button>
            </form>
            <div style={{ maxHeight: '45vh', overflowY: 'auto', marginTop: 8 }}>
              {matchResults === null && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Search for a statement line above.</div>}
              {matchResults?.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No transactions found.</div>}
              {matchResults?.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ wordBreak: 'break-word', fontSize: 14 }}>{t.rawDescription}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {t.batch.fileName} · {formatDate(t.transactionDate)} · {formatCurrency(t.amount)}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={matching}
                    onClick={() => matchAction(() => api.post(`/bank-settlements/transactions/${t.id}/match`, { expenseId: id }), 'Match failed')}
                  >
                    Link
                  </button>
                </div>
              ))}
            </div>
            {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
            <button className="btn" style={{ width: '100%', marginTop: 12 }} onClick={() => setShowMatchPicker(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
