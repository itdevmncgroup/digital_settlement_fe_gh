'use client';

import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, downloadFile, postForm } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/date';
import DatePicker from '@/components/DatePicker';
import Modal from '@/components/Modal';
import { useToast } from '@/components/ToastProvider';
import NumberInput from '@/components/NumberInput';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import TransactionTotalsCards, { sumByBucket, TotalsBucket } from '@/components/TransactionTotalsCards';
import { usePrompt } from '@/components/PromptDialog';
import { useConfirm } from '@/components/ConfirmDialog';
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
  advertiser?: { name: string; agencies?: { agency: { name: string } }[] } | null;
  extraAgencies?: { agency: { name: string } }[];
  approvalRequest: ApprovalRequestInfo | null;
}

interface SettlementRow {
  id: string;
  settlementNo: string;
  totalAmount: string;
  // DRAFT (unused in practice) | DRAFT_SETTLEMENT | APPROVAL_SLS_MAR_DIR |
  // APPROVAL_SVP_ACC_BIL_TAX_3TV | APPROVAL_CO_CFO_3TV | APPROVAL_HEAD_CORSEC | APPROVAL_SVP | REVISION | READY_SENT_TO_ODOO | COMPLETE | REJECTED.
  status: string;
  // Only meaningful once status is READY_SENT_TO_ODOO or COMPLETE - NOT_STARTED | PENDING | SENT | FAILED.
  odooSyncStatus: string;
  odooSyncError: string | null;
  // Unit picked in "Create Draft PR" (its code is the PR's org_id) - preselected when retrying a FAILED send.
  odooUnitId: string | null;
  createdAt: string;
  department: { id: string; name: string };
  createdBy: { id: string; name: string };
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

// GET /settlements/:id/draft-pr/preview - the Settlement's allocation rows (built behind the scenes
// when it was created); only Description is editable here.
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

// Status combobox: five buckets that together cover every status. Draft = still with Sales (not submitted yet, or sent
// back for revision); Pending Approval = the approval tiers; Ready Sent to Odoo = approved, not sent yet; Complete = sent.
const STATUS_OPTIONS: { value: string; label: string; statuses: string[] }[] = [
  { value: 'DRAFT', label: 'Draft', statuses: ['DRAFT', 'DRAFT_SETTLEMENT', 'REVISION'] },
  {
    value: 'PENDING_APPROVAL',
    label: 'Pending Approval',
    statuses: ['APPROVAL_SLS_MAR_DIR', 'APPROVAL_SVP_ACC_BIL_TAX_3TV', 'APPROVAL_CO_CFO_3TV', 'APPROVAL_HEAD_CORSEC', 'APPROVAL_SVP'],
  },
  { value: 'COMPLETE', label: 'Complete', statuses: ['COMPLETE'] },
  { value: 'READY_SENT_TO_ODOO', label: 'Ready Sent to Odoo', statuses: ['READY_SENT_TO_ODOO'] },
  { value: 'REJECTED', label: 'Rejected', statuses: ['REJECTED'] },
];
const SYNC_OPTIONS = [
  { value: 'NOT_STARTED', label: 'Not sent' },
  { value: 'PENDING', label: 'Sending' },
  { value: 'SENT', label: 'Sent' },
  { value: 'FAILED', label: 'Failed' },
];

// yyyy-mm-dd of a timestamp in the user's own timezone (what the date pickers hold).
function localYmd(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Agencies of a Settlement's Expenses: the ones picked on each, or else its Advertiser's.
function settlementAgencyNames(r: SettlementRow): string[] {
  return r.expenses.flatMap((e) =>
    (e.extraAgencies?.length ? e.extraAgencies : (e.advertiser?.agencies ?? [])).map((x) => x.agency.name),
  );
}

// Totals cards: Completed = approved (ready to send or already sent to Odoo), Rejected = REJECTED, Pending = everything else.
const settlementBucket = (status: string): TotalsBucket =>
  status === 'COMPLETE' || status === 'READY_SENT_TO_ODOO' ? 'complete' : status === 'REJECTED' ? 'rejected' : 'pending';

// Friendlier labels for the two Odoo-hand-off statuses; every other status shows its raw value.
const STATUS_LABELS: Record<string, string> = { READY_SENT_TO_ODOO: 'Ready Sent to Odoo', COMPLETE: 'Complete' };

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// scope: Settlement > Entertainment = Entertainment Settlements, Settlement > Flower Bouquet = Flower Bouquet ones.
export default function SettlementListView({ scope = 'entertainment' }: { scope?: 'entertainment' | 'flower' }) {
  return (
    <Suspense fallback={<SplashLoader message="Loading" />}>
      <SettlementPageInner scope={scope} />
    </Suspense>
  );
}

function SettlementPageInner({ scope }: { scope: 'entertainment' | 'flower' }) {
  const router = useRouter();
  const group = scope === 'flower' ? 'flower' : 'entertainment';
  const searchParams = useSearchParams();
  const { user, hasRole, hasPermission } = useAuth();
  const toast = useToast();
  const [deletingId, setDeletingId] = useState('');
const [resendingId, setResendingId] = useState<string | null>(null);
  const canManage = hasRole('ADMINISTRATOR');
  const canGenerate = hasRole('SALES') || canManage || hasPermission('settlement.create.owndept');
  const prompt = usePrompt();
  const confirm = useConfirm();

  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  // "Create Draft PR" (pick a Unit, send a READY_SENT_TO_ODOO settlement to Odoo): Admin, or
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

  // Search panel - all client-side over the loaded list (the Department filter above narrows it server-side).
  const [statusFilter, setStatusFilter] = useState('');
  const [syncFilter, setSyncFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [advertiserFilter, setAdvertiserFilter] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const resetFilters = () => {
    setDepartmentFilter('');
    setStatusFilter('');
    setSyncFilter('');
    setFromDate('');
    setToDate('');
    setAgencyFilter('');
    setAdvertiserFilter('');
    setMinAmount('');
    setMaxAmount('');
    setBucketFilter(null);
  };
  const agencyNameOptions = Array.from(new Set(rows.flatMap(settlementAgencyNames))).sort();
  const advertiserNameOptions = Array.from(
    new Set(rows.flatMap((r) => r.expenses.map((e) => e.advertiser?.name).filter((n): n is string => !!n))),
  ).sort();

  const filteredRows = rows.filter((r) => {
    if (statusFilter && !STATUS_OPTIONS.find((o) => o.value === statusFilter)?.statuses.includes(r.status)) return false;
    if (syncFilter && r.odooSyncStatus !== syncFilter) return false;
    if (fromDate || toDate) {
      const day = localYmd(r.createdAt);
      if ((fromDate && day < fromDate) || (toDate && day > toDate)) return false;
    }
    if (agencyFilter) {
      const q = agencyFilter.toLowerCase();
      if (!settlementAgencyNames(r).some((n) => n.toLowerCase().includes(q))) return false;
    }
    if (advertiserFilter) {
      const q = advertiserFilter.toLowerCase();
      if (!r.expenses.some((e) => e.advertiser?.name.toLowerCase().includes(q))) return false;
    }
    const amount = Number(r.totalAmount);
    if (minAmount !== '' && amount < Number(minAmount)) return false;
    if (maxAmount !== '' && amount > Number(maxAmount)) return false;
    return true;
  });
  // Clicking a totals card narrows the table to that bucket (the cards keep showing every bucket's total).
  const [bucketFilter, setBucketFilter] = useState<TotalsBucket | null>(null);
  const visibleRows = bucketFilter ? filteredRows.filter((r) => settlementBucket(r.status) === bucketFilter) : filteredRows;
  const pagination = usePagination(visibleRows);

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
  // Description column of the preview, editable: allocation id -> text. Saved by the server when sending.
  const [draftPrDescriptions, setDraftPrDescriptions] = useState<Record<string, string>>({});
  const [draftPrLoading, setDraftPrLoading] = useState(false);
  const [draftPrSending, setDraftPrSending] = useState(false);
  const [draftPrPdfLoading, setDraftPrPdfLoading] = useState(false);
  const [draftPrError, setDraftPrError] = useState('');
  // Bank statement PDF whose pages get inserted after the Form Jamuan pages.
  const [draftPrStatement, setDraftPrStatement] = useState<File | null>(null);

  const load = () => {
    const qs = `?group=${scope === 'flower' ? 'FLOWER' : 'ENTERTAINMENT'}${departmentFilter ? `&departmentId=${departmentFilter}` : ''}`;
    api
      .get<SettlementRow[]>(`/settlements${qs}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, [departmentFilter, scope]);

  // Lands here from the settlement approval email/push deep link
  // (`${APP_PUBLIC_URL}/settlement?open=<id>`, see approvals.service.ts
  // notifyStep) - auto-expand and scroll to that row once it's loaded.
  // The deep link always points at /settlement; a Flower Bouquet Settlement lives under Flower Bouquet (and the
  // other way round), so send it to the list that holds it.
  useEffect(() => {
    const open = searchParams.get('open');
    if (!open) return;
    api
      .get<{ expenses?: { activityType?: { name: string } | null }[] }>(`/settlements/${open}`)
      .then((st) => {
        const isFlower = (st.expenses ?? []).some((e) => e.activityType?.name === 'Flower Bouquet');
        if (isFlower && scope !== 'flower') router.replace(`/settlement/flower-bouquet?open=${open}`);
        else if (!isFlower && scope === 'flower') router.replace(`/settlement?open=${open}`);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Re-sends the current approval tier's email to its approver (no state change).
  const resendApprovalEmail = async (id: string) => {
    setResendingId(id);
    setError('');
    try {
      await api.post(`/settlements/${id}/resend-approval-email`);
      toast.success('Reminder email has been sent to the current approver.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resend approval email');
    } finally {
      setResendingId(null);
    }
  };

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
  const deleteDraft = async (r: SettlementRow) => {
    const ok = await confirm({
      title: 'Delete draft settlement?',
      message: `Draft ${r.settlementNo} will be permanently deleted and its expenses released. This cannot be undone.`,
      danger: true,
    });
    if (!ok) return;
    setDeletingId(r.id);
    setError('');
    try {
      await api.del(`/settlements/${r.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete draft settlement');
    } finally {
      setDeletingId('');
    }
  };

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
      const preview = await api.get<DraftPrPreview>(`/settlements/${settlementId}/draft-pr/preview?unitId=${unitId}`);
      setDraftPrPreview(preview);
      setDraftPrDescriptions(Object.fromEntries(preview.rows.map((a) => [a.id, a.description ?? ''])));
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
    // Units depend on the Settlement's Activity Type (Entertainment -> RCTI, Flower Bouquet -> GTV),
    // so they are fetched per Settlement. A single allowed Unit is picked for the user.
    setUnitOptions([]);
    api
      .get<UnitOption[]>(`/settlements/${r.id}/draft-pr/units`)
      .then((units) => {
        setUnitOptions(units);
        const retryAllowed = !!retryUnitId && units.some((u) => u.id === retryUnitId);
        if (retryAllowed) loadDraftPrPreview(r.id, retryUnitId);
        else if (units.length === 1) setDraftPrUnitId(units[0].id);
        else setDraftPrUnitId('');
      })
      .catch(() => setDraftPrError('Failed to load units'));
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
        { unitId: draftPrUnitId, descriptions: JSON.stringify(draftPrDescriptions) },
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
        <h1>{scope === 'flower' ? 'Settlement - Flower Bouquet' : 'Settlement - Entertainment'}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {canGenerate && (
            <Link href={`/settlement/create?group=${group}`} className="btn btn-primary">
              Create Settlement
            </Link>
          )}
        </div>
      </div>
      <TransactionTotalsCards
        totals={sumByBucket(filteredRows, (r) => settlementBucket(r.status), (r) => r.totalAmount)}
        selected={bucketFilter}
        onSelect={setBucketFilter}
      />

      <div className="toolbar" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} style={{ width: 200 }}>
            <option value="">{canManage ? 'All Departments' : 'All my Departments'}</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 220 }}>
            <option value="">All Status</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={syncFilter} onChange={(e) => setSyncFilter(e.target.value)} style={{ width: 150 }}>
            <option value="">All Odoo status</option>
            {SYNC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
          <input
            list="settlement-filter-agencies"
            placeholder="Search agency..."
            value={agencyFilter}
            onChange={(e) => setAgencyFilter(e.target.value)}
            style={{ width: 170 }}
          />
          <datalist id="settlement-filter-agencies">
            {agencyNameOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <input
            list="settlement-filter-advertisers"
            placeholder="Search advertiser..."
            value={advertiserFilter}
            onChange={(e) => setAdvertiserFilter(e.target.value)}
            style={{ width: 170 }}
          />
          <datalist id="settlement-filter-advertisers">
            {advertiserNameOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <NumberInput placeholder="Min amount" value={minAmount} onChange={setMinAmount} style={{ width: 140 }} />
          <NumberInput placeholder="Max amount" value={maxAmount} onChange={setMaxAmount} style={{ width: 140 }} />
          <button type="button" className="btn" onClick={resetFilters}>
            Reset
          </button>
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
                    <span className={`badge ${r.status === 'COMPLETE' ? 'badge-success' : r.status === 'READY_SENT_TO_ODOO' ? 'badge-warning' : 'badge-info'}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
                  </td>
                  <td>
                    {r.status === 'COMPLETE' || r.status === 'READY_SENT_TO_ODOO' ? (
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
                  <td>
                    <div className="row-actions">
                    {canGenerate && (r.status === 'DRAFT_SETTLEMENT' || r.status === 'REVISION') && (
                      <Link href={`/settlement/${r.id}/edit?group=${group}`} className="btn btn-xs">
                        {r.status === 'REVISION' ? 'Resubmit' : 'Edit'}
                      </Link>
                    )}
                    {canGenerate && r.status === 'DRAFT_SETTLEMENT' && (
                      <button className="btn btn-xs" disabled={busy} onClick={() => openAddExpensesModal(r)}>
                        Add Expenses
                      </button>
                    )}
                    {canGenerate && r.status === 'DRAFT_SETTLEMENT' && (
                      <button
                        className="btn btn-primary btn-xs"
                        disabled={busy || submittingDraftId === r.id}
                        onClick={() => submitDraft(r.id)}
                      >
                        {submittingDraftId === r.id ? 'Submitting...' : 'Submit'}
                      </button>
                    )}
                    {r.status === 'DRAFT_SETTLEMENT' && r.createdBy?.id === user?.id && hasPermission('settlement.draft.delete.own') && (
                      <button className="btn btn-danger btn-xs" disabled={busy || deletingId === r.id} onClick={() => deleteDraft(r)} title="Delete this draft settlement">
                        {deletingId === r.id ? 'Deleting...' : 'Delete'}
                      </button>
                    )}
                    {canGenerate && r.status.startsWith('APPROVAL_') && (
                      <button
                        type="button"
                        className="btn btn-xs"
                        disabled={resendingId === r.id}
                        onClick={() => resendApprovalEmail(r.id)}
                        title="Resend the approval email to the current approver"
                      >
                        {resendingId === r.id ? 'Sending...' : 'Resend'}
                      </button>
                    )}
                    {canManage && r.status === 'DRAFT' && (
                      <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => markComplete(r.id)}>
                        Mark Complete
                      </button>
                    )}
                    {canDraftPr(r.department.id) && (r.status === 'READY_SENT_TO_ODOO' || r.status === 'COMPLETE') && (
                      <button
                        className="btn btn-xs btn-icon-xs"
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
                    {canDraftPr(r.department.id) && r.status === 'READY_SENT_TO_ODOO' && r.odooSyncStatus === 'FAILED' && (
                      <button
                        className="btn btn-primary btn-xs"
                        title={r.odooSyncError ? `Send to Odoo failed: ${r.odooSyncError}` : 'Send to Odoo failed'}
                        disabled={busy}
                        onClick={() => openDraftPr(r)}
                      >
                        Retry Send to Odoo
                      </button>
                    )}
                    </div>
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
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--muted)' }}>
                  No settlements
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {visibleRows.length > 0 && (
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
                      <td style={{ minWidth: 280 }}>
                        <textarea
                          rows={3}
                          aria-label={`Description ${a.unitCode}`}
                          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                          disabled={draftPrSending}
                          value={draftPrDescriptions[a.id] ?? ''}
                          onChange={(e) => setDraftPrDescriptions((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        />
                      </td>
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
