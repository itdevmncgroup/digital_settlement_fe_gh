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
import { useConfirm } from '@/components/ConfirmDialog';
import PillTabs from '@/components/PillTabs';
import SettlementApprovalModal from '@/components/SettlementApprovalModal';
import { MATCH_FIRST_MESSAGE, mustMatchBeforeApprove } from '@/lib/expenseApproval';
import NumberInput from '@/components/NumberInput';
import TransactionTotalsCards, { TransactionTotals, TotalsBucket } from '@/components/TransactionTotalsCards';
import {
  clientLabel,
  currentApprovalStep,
  EXPENSE_REQUEST_STATUS_LABEL,
  ExpenseRequest,
  POSITION_CORSEC,
  POSITION_SALES_CS,
} from '@/lib/expenseRequests';

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
  activityType?: { name: string } | null;
  status?: string;
  isMatched?: boolean;
  department?: { id: string; name: string } | null;
  advertiser: { name: string };
  brand: { name: string };
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
  department: { id?: string; name: string } | null;
  createdBy: { name: string };
  expenses: { id: string; activityType?: { name: string } | null }[];
}

interface PendingApproval {
  id: string;
  documentStage: 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT';
  currentStep: number;
  steps: StepInfo[];
  expense: DocSummary | null;
  event: DocSummary | null;
  settlement: SettlementSummary | null;
  isMyTurn: boolean;
}

// What GET /settlements/:id returns that a bulk Settlement action needs.
interface SettlementDetail {
  expenses: { id: string; expenseNo: string; settlementApprovedStep: number | null }[];
  approvalRequest: { currentStep: number } | null;
}

type Tab = 'request' | 'flower' | 'entertainment' | 'settlement';

const TABS: { key: Tab; label: string }[] = [
  { key: 'request', label: 'Request' },
  { key: 'flower', label: 'Flower Bouquet' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'settlement', label: 'Settlement' },
];

const BUCKETS: TotalsBucket[] = ['pending', 'complete', 'rejected'];
const BUCKET_LABEL: Record<TotalsBucket, string> = { pending: 'Pending', complete: 'Complete', rejected: 'Rejected' };
// GET /approvals/pending?status=... per bucket (PENDING is the endpoint's default).
const BUCKET_STATUS: Record<TotalsBucket, string> = { pending: 'PENDING', complete: 'APPROVED', rejected: 'REJECTED' };

const FLOWER_ACTIVITY_TYPE = 'Flower Bouquet';

// One selectable row's bulk actions. `id` is what the checkbox tracks.
interface BulkTarget {
  id: string;
  label: string;
  approve: () => Promise<unknown>;
  reject: (reason: string) => Promise<unknown>;
}

// A Settlement batches Expenses that may differ in Activity Type - list each one once.
const settlementActivityTypes = (s: SettlementSummary) =>
  Array.from(new Set(s.expenses.map((e) => e.activityType?.name).filter((n): n is string => !!n))).join(', ');

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// DRAFT Requests have not entered the chain yet, so they belong to no bucket.
const requestBucket = (r: ExpenseRequest): TotalsBucket | null =>
  r.status === 'PROCEED'
    ? 'complete'
    : r.status === 'REJECTED' || r.status === 'CANCELLED'
      ? 'rejected'
      : r.status === 'DRAFT'
        ? null
        : 'pending';

const requestAmount = (r: ExpenseRequest) => Number(r.budgetAmount ?? r.requestBudget ?? 0) || 0;

const docAmount = (r: PendingApproval) => {
  if (r.settlement) return Number(r.settlement.totalAmount) || 0;
  return Number((r.expense ? r.expense.amount : r.event?.estimatedAmount) ?? 0) || 0;
};

const defaultFromDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};
const defaultToDate = () => new Date().toISOString().slice(0, 10);

const EMPTY_PANEL = { status: '', person: '', agency: '', advertiser: '', brand: '', activityType: '', min: '', max: '', sendFrom: '', sendTo: '' };

const emptyDocs = (): Record<TotalsBucket, PendingApproval[]> => ({ pending: [], complete: [], rejected: [] });

export default function ApprovalsPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole('ADMINISTRATOR');
  const canActOnBehalf = isAdmin;
  const prompt = usePrompt();
  const confirm = useConfirm();

  const [tab, setTab] = useState<Tab>('request');
  // Which status card is selected; the table lists that bucket (Pending by default).
  const [bucket, setBucket] = useState<TotalsBucket>('pending');
  const [docs, setDocs] = useState<Record<TotalsBucket, PendingApproval[]>>(emptyDocs);
  // Expense Requests (Flower Bouquet) are a separate flow: GET /approvals/pending leaves them out.
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
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

  // Search panel fields beyond Department / dates: client-side, per tab (see passesPanel).
  const [panel, setPanel] = useState(EMPTY_PANEL);
  const setField = (key: keyof typeof EMPTY_PANEL) => (value: string) => setPanel((prev) => ({ ...prev, [key]: value }));
  const resetFilters = () => {
    setPanel(EMPTY_PANEL);
    setDepartmentFilter('');
    setFromDate(defaultFromDate());
    setToDate(defaultToDate());
    setSearch('');
    setSearchInput('');
  };

  const load = () => {
    const base = new URLSearchParams();
    if (departmentFilter) base.set('departmentId', departmentFilter);
    if (fromDate) base.set('fromDate', fromDate);
    if (toDate) base.set('toDate', toDate);
    Promise.all(
      BUCKETS.map((b) => {
        const params = new URLSearchParams(base);
        params.set('status', BUCKET_STATUS[b]);
        return api.get<PendingApproval[]>(`/approvals/pending?${params.toString()}`);
      }),
    )
      .then(([pending, complete, rejected]) => setDocs({ pending, complete, rejected }))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    // Best-effort: a failure here must not hide the other tabs.
    api
      .get<ExpenseRequest[]>('/expense-requests')
      .then(setRequests)
      .catch(() => setRequests([]));
  };

  useEffect(load, [departmentFilter, fromDate, toDate]);

  // Settlement shown in the review popup. The email's "Desktop Mode" button lands here as /approvals?open=<id>.
  const [openSettlementId, setOpenSettlementId] = useState<string | null>(null);
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get('open');
    if (open) {
      setTab('settlement');
      setOpenSettlementId(open);
    }
  }, []);
  const closeSettlement = () => {
    setOpenSettlementId(null);
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  };

  useEffect(() => {
    const path = canActOnBehalf ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canActOnBehalf]);

  // Deliberately narrower than the Expense detail page's canAct: only the step's
  // actual resolvedApprover (or an ADMIN override) gets a button here, so it
  // disappears the moment they act and only reappears for whoever the *next*
  // step resolves to - an expense.approve.all/owndept holder can still act via
  // the Expense detail page (backend's assertApprovalOverride still allows it),
  // it just isn't surfaced as a button on every department-wide pending row in this list.
  const canActOn = (step: { resolvedApprover?: { id: string } } | undefined) =>
    !!step && (step.resolvedApprover?.id === user?.id || isAdmin);

  // Expense Request: the approval step is the user's (or ADMIN), the budget stage and the user is
  // Sales Customer Service (or ADMIN), or the Corsec verification stage and the user is Corsec (or ADMIN).
  const requestNeedsMyAction = (r: ExpenseRequest) => {
    if (r.status === 'BUDGET_INPUT') return user?.position?.code === POSITION_SALES_CS || isAdmin;
    if (r.status === 'CORSEC_VERIFICATION') return user?.position?.code === POSITION_CORSEC || isAdmin;
    return canActOn(currentApprovalStep(r));
  };

  const matches = (values: (string | null | undefined)[]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return values.some((v) => v?.toLowerCase().includes(q));
  };

  const matchesDoc = (r: PendingApproval) => {
    if (r.settlement) {
      const s = r.settlement;
      return matches([s.settlementNo, s.createdBy?.name, s.department?.name, settlementActivityTypes(s)]);
    }
    const doc = r.expense ?? r.event;
    if (!doc) return false;
    const docNo = r.expense ? doc.expenseNo : doc.eventNo;
    return matches([docNo, doc.sales?.name, doc.activityType?.name, doc.advertiser?.name, doc.brand?.name]);
  };
  const isFlowerDoc = (r: PendingApproval) => r.expense?.activityType?.name === FLOWER_ACTIVITY_TYPE;

  const contains = (value: string | null | undefined, q: string) => !q.trim() || !!value?.toLowerCase().includes(q.trim().toLowerCase());

  // Rows of one tab in one bucket, with the search / Department filters applied (not the tab's own search panel).
  const baseRows = (t: Tab, b: TotalsBucket): unknown[] => {
    if (t === 'request') {
      // The list only returns Requests the user may see (own Department(s) / inputter / approver).
      return requests.filter(
        (r) =>
          requestBucket(r) === b &&
          (!departmentFilter || r.department?.id === departmentFilter) &&
          matches([r.requestNo, r.requestedBy?.name, r.department?.name, clientLabel(r), r.greetingText, r.recipient]),
      );
    }
    return docs[b].filter((r) => {
      if (!matchesDoc(r)) return false;
      if (t === 'settlement') return !!r.settlement;
      if (r.settlement || !(r.expense || r.event)) return false;
      return t === 'flower' ? isFlowerDoc(r) : !isFlowerDoc(r);
    });
  };

  // The search panel's own fields. They differ per tab, so they apply to the active tab only and reset when it changes.
  const passesPanel = (t: Tab, row: unknown): boolean => {
    const amount = amountOf(t, row);
    if (panel.min !== '' && amount < Number(panel.min)) return false;
    if (panel.max !== '' && amount > Number(panel.max)) return false;
    if (t === 'request') {
      const r = row as ExpenseRequest;
      if (panel.status && r.status !== panel.status) return false;
      if (!contains(r.requestedBy?.name, panel.person)) return false;
      if (panel.agency.trim() && !r.agencies?.some((a) => contains(a.agency.name, panel.agency))) return false;
      if (panel.advertiser.trim() && !r.advertisers?.some((a) => contains(a.advertiser.name, panel.advertiser))) return false;
      // sendDate is a calendar day, so its first 10 characters (yyyy-mm-dd) compare directly with the pickers.
      const day = r.sendDate.slice(0, 10);
      return !((panel.sendFrom && day < panel.sendFrom) || (panel.sendTo && day > panel.sendTo));
    }
    const r = row as PendingApproval;
    if (t === 'settlement') {
      const st = r.settlement!;
      if (!contains(st.createdBy?.name, panel.person)) return false;
      return !panel.activityType || st.expenses.some((e) => e.activityType?.name === panel.activityType);
    }
    const doc = r.expense ?? r.event;
    if (!doc) return false;
    if (!contains(doc.sales?.name, panel.person)) return false;
    if (!contains(doc.advertiser?.name, panel.advertiser)) return false;
    if (!contains(doc.brand?.name, panel.brand)) return false;
    return !panel.activityType || doc.activityType?.name === panel.activityType;
  };

  const rowsFor = (t: Tab, b: TotalsBucket): unknown[] => {
    const rows = baseRows(t, b);
    return t === tab ? rows.filter((r) => passesPanel(t, r)) : rows;
  };

  // Suggestions / select options for the panel: every row of the active tab, whatever its bucket.
  const poolRows = BUCKETS.flatMap((b) => baseRows(tab, b));
  const uniqueSorted = (names: (string | null | undefined)[]) =>
    Array.from(new Set(names.filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b));
  const poolDocs = tab === 'request' ? [] : (poolRows as PendingApproval[]);
  const poolRequests = tab === 'request' ? (poolRows as ExpenseRequest[]) : [];
  const agencyOptions = uniqueSorted(poolRequests.flatMap((r) => (r.agencies ?? []).map((a) => a.agency.name)));
  const advertiserOptions = uniqueSorted(
    tab === 'request' ? poolRequests.flatMap((r) => (r.advertisers ?? []).map((a) => a.advertiser.name)) : poolDocs.map((r) => (r.expense ?? r.event)?.advertiser?.name),
  );
  const brandOptions = uniqueSorted(poolDocs.map((r) => (r.expense ?? r.event)?.brand?.name));
  const activityTypeOptions = uniqueSorted(
    poolDocs.flatMap((r) => (r.settlement ? r.settlement.expenses.map((e) => e.activityType?.name) : [(r.expense ?? r.event)?.activityType?.name])),
  );
  // Statuses an Expense Request can have inside the selected card.
  const requestStatusOptions: ExpenseRequest['status'][] =
    bucket === 'pending' ? ['PENDING_APPROVAL', 'BUDGET_INPUT', 'CORSEC_VERIFICATION'] : bucket === 'complete' ? ['PROCEED'] : ['REJECTED', 'CANCELLED'];

  const amountOf = (t: Tab, row: unknown) => (t === 'request' ? requestAmount(row as ExpenseRequest) : docAmount(row as PendingApproval));
  const totalsFor = (t: Tab): TransactionTotals => {
    const sum = (b: TotalsBucket) => {
      const rows = rowsFor(t, b);
      return { count: rows.length, amount: rows.reduce<number>((acc, r) => acc + amountOf(t, r), 0) };
    };
    return { pending: sum('pending'), complete: sum('complete'), rejected: sum('rejected') };
  };

  const totals = totalsFor(tab);
  const activeRows = rowsFor(tab, bucket);
  const pagination = usePagination<unknown>(activeRows);
  const isPending = bucket === 'pending';

  const resetSelection = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setPanel(EMPTY_PANEL);
    resetSelection();
  };

  const switchBucket = (next: TotalsBucket | null) => {
    setBucket(next ?? 'pending');
    // A status only exists inside one card.
    setPanel((prev) => ({ ...prev, status: '' }));
    resetSelection();
  };

  const runSingle = async (id: string, call: () => Promise<unknown>, failMessage: string) => {
    setBusyId(id);
    setError('');
    try {
      await call();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failMessage);
    } finally {
      setBusyId('');
    }
  };

  const approve = (r: PendingApproval) => {
    const kind = r.expense ? 'expense' : 'event';
    return runSingle(r.id, () => api.post(`/approvals/${kind}/${(r.expense ?? r.event)!.id}/approve`), 'Approve failed');
  };

  const reject = async (r: PendingApproval) => {
    const reason = await prompt({ title: 'Reject reason', danger: true });
    if (!reason) return;
    const kind = r.expense ? 'expense' : 'event';
    await runSingle(r.id, () => api.post(`/approvals/${kind}/${(r.expense ?? r.event)!.id}/reject`, { reason }), 'Reject failed');
  };

  const approveRequest = (r: ExpenseRequest) =>
    runSingle(r.id, () => api.post(`/approvals/expense-request/${r.id}/approve`), 'Approve failed');

  const rejectRequest = async (r: ExpenseRequest) => {
    const reason = await prompt({ title: 'Reject reason', danger: true });
    if (!reason) return;
    await runSingle(r.id, () => api.post(`/approvals/expense-request/${r.id}/reject`, { reason }), 'Reject failed');
  };

  const proceedRequest = (r: ExpenseRequest) =>
    runSingle(r.id, () => api.post(`/expense-requests/${r.id}/verify`, { decision: 'PROCEED' }), 'Proceed failed');

  const cancelRequest = async (r: ExpenseRequest) => {
    const reason = await prompt({ title: 'Cancel reason', danger: true });
    if (!reason) return;
    await runSingle(r.id, () => api.post(`/expense-requests/${r.id}/verify`, { decision: 'CANCELLED', reason }), 'Cancel failed');
  };

  // --- Bulk -----------------------------------------------------------------
  // Backend has no batch approve/reject endpoint (see approvals.controller.ts), so each selected
  // document fires its own calls, one at a time so one failure doesn't fire a burst of retries;
  // failures are collected and reported together instead of aborting the whole batch.

  const requestTarget = (r: ExpenseRequest): BulkTarget | null => {
    // "Input Budget" has no approve/reject, so it never takes part in bulk selection.
    if (r.status === 'BUDGET_INPUT' || !requestNeedsMyAction(r)) return null;
    const verifying = r.status === 'CORSEC_VERIFICATION';
    return {
      id: r.id,
      label: r.requestNo,
      approve: () =>
        verifying
          ? api.post(`/expense-requests/${r.id}/verify`, { decision: 'PROCEED' })
          : api.post(`/approvals/expense-request/${r.id}/approve`),
      reject: (reason) =>
        verifying
          ? api.post(`/expense-requests/${r.id}/verify`, { decision: 'CANCELLED', reason })
          : api.post(`/approvals/expense-request/${r.id}/reject`, { reason }),
    };
  };

  // Pre-Event rows still go through their own single approve/reject action.
  const expenseTarget = (r: PendingApproval): BulkTarget | null => {
    if (!r.expense || !canActOn(r.steps.find((s) => s.stepOrder === r.currentStep))) return null;
    const id = r.expense.id;
    return {
      id,
      label: r.expense.expenseNo ?? id,
      // Flower Bouquet at the Sales Admin tier must be matched first - reported as a per-row failure.
      approve: () =>
        mustMatchBeforeApprove(r.expense, r.steps.find((s) => s.stepOrder === r.currentStep)?.position.code)
          ? Promise.reject(new ApiError(400, MATCH_FIRST_MESSAGE))
          : api.post(`/approvals/expense/${id}/approve`),
      reject: (reason) => api.post(`/approvals/expense/${id}/reject`, { reason }),
    };
  };

  // A Settlement tier only advances once its approver has reviewed every member Expense and then
  // submits, so bulk-acting on a Settlement is: review all members still open at this tier, then
  // submit. Rejecting every member (they leave the batch) makes the submit reject the whole Settlement.
  const settlementTarget = (r: PendingApproval): BulkTarget | null => {
    const s = r.settlement;
    if (!s || !canActOn(r.steps.find((st) => st.stepOrder === r.currentStep))) return null;
    const reviewAll = async (action: 'approve' | 'reject', body?: { reason: string }) => {
      const detail = await api.get<SettlementDetail>(`/settlements/${s.id}`);
      const tier = detail.approvalRequest?.currentStep ?? r.currentStep;
      const members = action === 'approve' ? detail.expenses.filter((e) => (e.settlementApprovedStep ?? -1) < tier) : detail.expenses;
      for (const e of members) await api.post(`/settlements/${s.id}/expenses/${e.id}/${action}`, body);
      await api.post(`/settlements/${s.id}/submit`);
    };
    return {
      id: s.id,
      label: s.settlementNo,
      approve: () => reviewAll('approve'),
      reject: (reason) => reviewAll('reject', { reason }),
    };
  };

  const targetOf = (row: unknown): BulkTarget | null =>
    tab === 'request'
      ? requestTarget(row as ExpenseRequest)
      : tab === 'settlement'
        ? settlementTarget(row as PendingApproval)
        : expenseTarget(row as PendingApproval);

  const allTargets = isPending ? activeRows.map(targetOf).filter((t): t is BulkTarget => !!t) : [];
  const pageTargets = isPending ? pagination.pageRows.map(targetOf).filter((t): t is BulkTarget => !!t) : [];
  const targetById = new Map(allTargets.map((t) => [t.id, t]));

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    if (!targetById.has(id)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageAllSelected = pageTargets.length > 0 && pageTargets.every((t) => selectedIds.has(t.id));
  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const t of pageTargets) {
        if (pageAllSelected) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  };

  const runBulk = async (call: (t: BulkTarget) => Promise<unknown>) => {
    const targets = Array.from(selectedIds)
      .map((id) => targetById.get(id))
      .filter((t): t is BulkTarget => !!t);
    setBulkBusy(true);
    let success = 0;
    const failures: string[] = [];
    for (const t of targets) {
      try {
        await call(t);
        success++;
      } catch (err) {
        failures.push(`${t.label}: ${err instanceof ApiError ? err.message : 'Failed'}`);
      }
    }
    setBulkBusy(false);
    resetSelection();
    setError(failures.length === 0 ? '' : `${success} succeeded, ${failures.length} failed - ${failures.join('; ')}`);
    load();
  };

  const noun = tab === 'request' ? 'request(s)' : tab === 'settlement' ? 'settlement(s)' : 'expense(s)';

  const bulkApprove = async () => {
    if (
      tab === 'settlement' &&
      !(await confirm({
        title: `Approve ${selectedIds.size} settlement(s)?`,
        message: 'Every member expense still open at your tier is approved, then the tier is submitted.',
        confirmLabel: 'Approve',
      }))
    ) {
      return;
    }
    runBulk((t) => t.approve());
  };

  const bulkReject = async () => {
    const reason = await prompt({
      title: `Reject ${selectedIds.size} ${noun}`,
      label: tab === 'settlement' ? 'Reason (every member expense is rejected, so each Settlement is rejected as a whole)' : 'Reason',
      danger: true,
    });
    if (!reason) return;
    runBulk((t) => t.reject(reason));
  };

  const showSelect = isPending && allTargets.length > 0;
  const columnCount = tab === 'request' ? 9 : tab === 'settlement' ? 7 : 9;
  const emptyColSpan = columnCount + (selectMode ? 1 : 0);
  const emptyText = `No ${BUCKET_LABEL[bucket].toLowerCase()} ${tab === 'request' ? 'Expense Request' : 'approval'}`;
  const stepText = (r: PendingApproval, currentStep: StepInfo | undefined) =>
    isPending ? `${r.currentStep + 1} / ${r.steps.length} (${currentStep?.position.name ?? '-'})` : BUCKET_LABEL[bucket];

  const checkboxCell = (id: string) => {
    const selectable = targetById.has(id);
    return (
      <td>
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          disabled={!selectable || bulkBusy}
          checked={selectable && selectedIds.has(id)}
          onChange={() => toggleSelected(id)}
        />
      </td>
    );
  };

  return (
    <div>
      <div className="toolbar">
        <h1>{selectMode ? `${selectedIds.size} selected` : 'Approval'}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search doc no, sales, activity type, advertiser, brand..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          {showSelect && (
            <button className="btn" disabled={bulkBusy} onClick={toggleSelectMode}>
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
        </div>
      </div>
      <PillTabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: rowsFor(t.key, 'pending').length }))}
        active={tab}
        onChange={switchTab}
      />
      <TransactionTotalsCards totals={totals} selected={bucket} onSelect={switchBucket} />
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
          {tab === 'request' ? (
            <>
              <select value={panel.status} onChange={(e) => setField('status')(e.target.value)} style={{ width: 190 }}>
                <option value="">All Status</option>
                {requestStatusOptions.map((st) => (
                  <option key={st} value={st}>
                    {EXPENSE_REQUEST_STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
                Send date From
                <DatePicker value={panel.sendFrom} onChange={setField('sendFrom')} style={{ width: 150 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
                To
                <DatePicker value={panel.sendTo} onChange={setField('sendTo')} style={{ width: 150 }} />
              </label>
            </>
          ) : (
            <>
              {/* Server-side: narrows what GET /approvals/pending returns (expense date / settlement created date). */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
                Date From
                <DatePicker value={fromDate} onChange={setFromDate} style={{ width: 150 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
                To
                <DatePicker value={toDate} onChange={setToDate} style={{ width: 150 }} />
              </label>
            </>
          )}
          <input
            placeholder={tab === 'request' ? 'Requested by...' : tab === 'settlement' ? 'Created by...' : 'Sales...'}
            value={panel.person}
            onChange={(e) => setField('person')(e.target.value)}
            style={{ width: 150 }}
          />
          {tab === 'request' && (
            <input list="approval-filter-agencies" placeholder="Search agency..." value={panel.agency} onChange={(e) => setField('agency')(e.target.value)} style={{ width: 170 }} />
          )}
          {tab !== 'settlement' && (
            <input list="approval-filter-advertisers" placeholder="Search advertiser..." value={panel.advertiser} onChange={(e) => setField('advertiser')(e.target.value)} style={{ width: 170 }} />
          )}
          {(tab === 'flower' || tab === 'entertainment') && (
            <input list="approval-filter-brands" placeholder="Search brand..." value={panel.brand} onChange={(e) => setField('brand')(e.target.value)} style={{ width: 150 }} />
          )}
          {(tab === 'entertainment' || tab === 'settlement') && (
            <select value={panel.activityType} onChange={(e) => setField('activityType')(e.target.value)} style={{ width: 180 }}>
              <option value="">All Activity Types</option>
              {activityTypeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          <NumberInput placeholder={tab === 'request' ? 'Min budget' : 'Min amount'} value={panel.min} onChange={setField('min')} style={{ width: 140 }} />
          <NumberInput placeholder={tab === 'request' ? 'Max budget' : 'Max amount'} value={panel.max} onChange={setField('max')} style={{ width: 140 }} />
          <button type="button" className="btn" onClick={resetFilters}>
            Reset
          </button>
          <datalist id="approval-filter-agencies">
            {agencyOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <datalist id="approval-filter-advertisers">
            {advertiserOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <datalist id="approval-filter-brands">
            {brandOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      {selectMode && selectedIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {selectedIds.size} {noun} selected
          </span>
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
                  <input type="checkbox" style={{ width: 'auto' }} checked={pageAllSelected} disabled={bulkBusy} onChange={toggleSelectPage} />
                </th>
              )}
              {tab === 'request' ? (
                <>
                  <th>Request No</th>
                  <th>Requested By</th>
                  <th>Department</th>
                  <th>Client</th>
                  <th>Send Date</th>
                  <th>Status</th>
                  <th>Step</th>
                  <th>Action</th>
                  <th />
                </>
              ) : tab === 'settlement' ? (
                <>
                  <th>Settlement No</th>
                  <th>Created By</th>
                  <th>Department</th>
                  <th>Amount</th>
                  <th>Expenses</th>
                  <th>Step</th>
                  <th>Action</th>
                </>
              ) : (
                <>
                  <th>Doc No</th>
                  <th>Date</th>
                  <th>Sales</th>
                  <th>Department</th>
                  <th>Advertiser</th>
                  <th>Brand</th>
                  <th>Amount</th>
                  <th>Step</th>
                  <th>Action</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {tab === 'request' &&
              (pagination.pageRows as ExpenseRequest[]).map((r) => {
                const step = currentApprovalStep(r);
                const busy = busyId === r.id;
                const mine = isPending && requestNeedsMyAction(r);
                const stepLabel = !isPending
                  ? BUCKET_LABEL[bucket]
                  : r.status === 'BUDGET_INPUT'
                    ? 'Waiting budget'
                    : r.status === 'CORSEC_VERIFICATION'
                      ? 'Corsec verification'
                      : `${(step?.stepOrder ?? 0) + 1} / ${r.approvalRequest?.steps.length ?? 1} (${step?.position.name ?? '-'})`;
                const selectable = targetById.has(r.id);
                return (
                  <tr key={r.id} style={selectMode && !selectable ? { opacity: 0.5 } : undefined}>
                    {selectMode && checkboxCell(r.id)}
                    <td>{r.requestNo}</td>
                    <td>{r.requestedBy?.name}</td>
                    <td>{r.department?.name ?? '-'}</td>
                    <td>{clientLabel(r)}</td>
                    <td>{formatDate(r.sendDate)}</td>
                    <td>{EXPENSE_REQUEST_STATUS_LABEL[r.status]}</td>
                    <td>{stepLabel}</td>
                    <td>
                      {mine && r.status === 'PENDING_APPROVAL' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-approve" disabled={busy} onClick={() => approveRequest(r)}>
                            Approve
                          </button>
                          <button className="btn btn-reject" disabled={busy} onClick={() => rejectRequest(r)}>
                            Reject
                          </button>
                        </div>
                      )}
                      {mine && r.status === 'CORSEC_VERIFICATION' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-approve" disabled={busy} onClick={() => proceedRequest(r)}>
                            Proceed
                          </button>
                          <button className="btn btn-reject" disabled={busy} onClick={() => cancelRequest(r)}>
                            Cancel
                          </button>
                        </div>
                      )}
                      {mine && r.status === 'BUDGET_INPUT' && <Link href="/expense-requests">Input Budget</Link>}
                    </td>
                    <td>
                      <Link href="/expense-requests">Open</Link>
                    </td>
                  </tr>
                );
              })}
            {tab === 'settlement' &&
              (pagination.pageRows as PendingApproval[]).map((r) => {
                const s = r.settlement!;
                const currentStep = r.steps.find((st) => st.stepOrder === r.currentStep);
                const selectable = targetById.has(s.id);
                return (
                  <tr key={r.id} style={selectMode && !selectable ? { opacity: 0.5 } : undefined}>
                    {selectMode && checkboxCell(s.id)}
                    <td>
                      <a
                        href={`/approvals?open=${s.id}`}
                        onClick={(ev) => {
                          ev.preventDefault();
                          setOpenSettlementId(s.id);
                        }}
                      >
                        {s.settlementNo}
                      </a>
                    </td>
                    <td>{s.createdBy?.name}</td>
                    <td>{s.department?.name ?? '-'}</td>
                    <td>{formatCurrency(s.totalAmount ?? 0)}</td>
                    <td>{s.expenses.length}</td>
                    <td>{stepText(r, currentStep)}</td>
                    <td>
                      {/* The tier is reviewed expense by expense in the popup; bulk Select is the shortcut. */}
                      {isPending && canActOn(currentStep) && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          title="Review this Settlement"
                          onClick={() => setOpenSettlementId(s.id)}
                          style={{ padding: '4px 12px', fontSize: 12, gap: 5, borderRadius: 999, whiteSpace: 'nowrap', lineHeight: 1.4 }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            {(tab === 'flower' || tab === 'entertainment') &&
              (pagination.pageRows as PendingApproval[]).map((r) => {
                const doc = r.expense ?? r.event;
                if (!doc) return null;
                const href = r.expense ? `/expenses/${doc.id}` : `/events/${doc.id}`;
                const docNo = r.expense ? doc.expenseNo : doc.eventNo;
                const amount = r.expense ? doc.amount : doc.estimatedAmount;
                const date = r.expense ? doc.expenseDate : doc.date;
                const currentStep = r.steps.find((s) => s.stepOrder === r.currentStep);
                const busy = busyId === r.id;
                const selectable = targetById.has(doc.id);
                return (
                  <tr key={r.id} style={selectMode && !selectable ? { opacity: 0.5 } : undefined}>
                    {selectMode && checkboxCell(doc.id)}
                    <td>
                      <Link href={href}>{docNo}</Link>
                    </td>
                    <td>{formatDate(date)}</td>
                    <td>{doc.sales?.name}</td>
                    <td>{doc.department?.name ?? '-'}</td>
                    <td>{doc.advertiser?.name}</td>
                    <td>{doc.brand?.name}</td>
                    <td>{formatCurrency(amount ?? 0)}</td>
                    <td>{stepText(r, currentStep)}</td>
                    <td>
                      {isPending && canActOn(currentStep) && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-approve"
                            disabled={busy || mustMatchBeforeApprove(r.expense, currentStep?.position.code)}
                            title={mustMatchBeforeApprove(r.expense, currentStep?.position.code) ? MATCH_FIRST_MESSAGE : undefined}
                            onClick={() => approve(r)}
                          >
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
            {activeRows.length === 0 && (
              <tr>
                <td colSpan={emptyColSpan} style={{ color: 'var(--muted)' }}>{emptyText}</td>
              </tr>
            )}
          </tbody>
        </table>
        {activeRows.length > 0 && (
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
      {openSettlementId && <SettlementApprovalModal settlementId={openSettlementId} onClose={closeSettlement} onChanged={load} />}
    </div>
  );
}
