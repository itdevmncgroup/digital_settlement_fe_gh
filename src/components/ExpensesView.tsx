'use client';

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, uploadFile, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAutoMatch, ScannedBatch, ScannedTransactionRow } from '@/lib/autoMatch';
import { formatDate } from '@/lib/date';
import NumberInput from '@/components/NumberInput';
import DatePicker from '@/components/DatePicker';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import TransactionTotalsCards, { sumByBucket, TotalsBucket } from '@/components/TransactionTotalsCards';
import LocalFileThumb from '@/components/LocalFileThumb';
import ExpenseImagesModal from '@/components/ExpenseImagesModal';
import FileOrCameraInput from '@/components/FileOrCameraInput';
import SplashLoader from '@/components/SplashLoader';
import { useToast } from '@/components/ToastProvider';
import Modal from '@/components/Modal';
import { useConfirm } from '@/components/ConfirmDialog';
import ExpenseFromRequestModal from '@/components/ExpenseFromRequestModal';
import { NavIcon } from '@/components/NavIcons';

const MATCHED_TXN_STATUSES = ['AUTO_MATCHED', 'MANUAL_MATCHED'];

// Default view: all statuses, last 1 month - also what "Reset" restores.
function defaultFromDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}
// Local calendar date (not UTC), for the Expense Date a draft falls back to.
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface BankTransactionRef {
  id: string;
  status: string;
  batchId: string;
  batch: { id: string; fileName: string };
}

interface StatementLine {
  id: string;
  lineNo: number;
  transactionDate: string | null;
  rawDescription: string;
  amount: string;
}

interface ExpenseRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  purpose: string;
  amount: string;
  status: string;
  salesId: string;
  // Who keyed it in (differs from salesId when entered on someone else's behalf).
  createdById?: string | null;
  sales: { name: string };
  advertiser: { name: string; agencies?: { agency: { name: string } }[] } | null;
  activityType: { name: string } | null;
  extraAgencies?: { agency: { name: string } }[];
  brand: { name: string };
  department: { id: string; name: string } | null;
  bankTransactions: BankTransactionRef[];
  isMatched: boolean;
  settlement: { id: string; settlementNo: string; status: string } | null;
}

// Expense.isMatched is the source of truth (also true for a manual match with no
// billing-statement transaction at all - e.g. e-wallet/personal reimbursement) -
// don't re-derive it from bankTransactions, which is empty in that case.
function isMatched(row: { isMatched: boolean }) {
  return row.isMatched;
}

// Agencies explicitly tagged on the Expense; when none were, the Advertiser's own Agencies
// (Agency <-> Advertiser is many-to-many). Same rule as the dashboard's Expense-by-Agency.
function agencyNames(row: Pick<ExpenseRow, 'advertiser' | 'extraAgencies'>) {
  const tagged = (row.extraAgencies ?? []).map((e) => e.agency.name);
  const names = tagged.length ? tagged : (row.advertiser?.agencies ?? []).map((l) => l.agency.name);
  return names.length ? Array.from(new Set(names)).join(', ') : '-';
}

function matchedTransaction(row: { bankTransactions: BankTransactionRef[] }) {
  return row.bankTransactions.find((t) => MATCHED_TXN_STATUSES.includes(t.status)) || null;
}

// A Settlement stays DRAFT_SETTLEMENT until its own "Submit" is pressed
// (settlements.service.ts) - manual match/unmatch is only safe up to that
// point, same rule the backend now enforces on the match endpoints.
function isSettlementSubmitted(row: { settlement: { status: string } | null }) {
  return !!row.settlement && row.settlement.status !== 'DRAFT_SETTLEMENT';
}

// PENDING_SALES_ADMIN: raised by Corsec from an Expense Request, completed by a Sales Admin of its Department.
const EDITABLE_STATUSES = ['DRAFT', 'PENDING_SALES_ADMIN', 'REJECTED', 'REVISION'];

// Anything currently sitting with an approver - matches ApprovalStatus.PENDING
// on the backend's ApprovalRequest for this Expense.
function isPendingApprovalStatus(status: string) {
  return status === 'PENDING_APPROVAL' || status.startsWith('APPROVAL_');
}

interface SimpleOption {
  id: string;
  name: string;
}

interface PaymentMethodOption {
  id: string;
  code: string;
  name: string;
}

interface SalesOption {
  id: string;
  name: string;
  employeeId: string;
  roles: string[];
  unitId?: string | null;
  departmentIds?: string[];
}

interface ItemRow {
  description: string;
  price: string;
  qty: string;
  categoryId: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface ParsedReceiptItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ParsedReceipt {
  merchantName: string | null;
  invoiceDate: string | null;
  items: ParsedReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  serviceCharge: number | null;
  total: number | null;
  confidence: number;
  warnings: string[];
}

interface CreditCardOption {
  id: string;
  bank: string;
  last4: string;
  user: { id: string; name: string } | null;
}

interface AdvertiserOption {
  id: string;
  code: string;
  name: string;
}

interface AgencyOption {
  id: string;
  code: string;
  name: string;
}

const OTHERS_COMPANY = '__OTHERS__';

interface BrandOption {
  id: string;
  code: string;
  name: string;
  advertiserId: string;
}

type ParticipantCategory = 'AGENCY' | 'ADVERTISER' | 'EMPLOYEE';

interface ParticipantRow {
  category: ParticipantCategory;
  name: string;
  position: string;
  company: string;
  /** UI-only: true while "Others" is picked in the company combobox, showing a free-text field instead. */
  companyOther?: boolean;
}

const PARTICIPANT_SECTIONS: { category: ParticipantCategory; label: string }[] = [
  { category: 'AGENCY', label: 'Agency' },
  { category: 'ADVERTISER', label: 'Advertiser' },
  { category: 'EMPLOYEE', label: 'Employee' },
];

// Status combobox: four buckets that together cover every status (the API's statusGroup - Draft = still with Sales,
// Pending Approval = the approval tiers and what follows, Complete, Rejected).
const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'REJECTED', label: 'Rejected' },
];
const ALL_STATUSES_VALUE = 'ALL';
// Totals cards: Completed = fully done (APPROVED/SETTLED are legacy rows), Rejected = REJECTED, Pending = everything else.
const COMPLETE_STATUSES = ['COMPLETE', 'APPROVED', 'SETTLED'];
const expenseBucket = (status: string): TotalsBucket =>
  COMPLETE_STATUSES.includes(status) ? 'complete' : status === 'REJECTED' ? 'rejected' : 'pending';
const itemSubtotal = (item: ItemRow) => (Number(item.price) || 0) * (Number(item.qty) || 0);
const emptyParticipant = (category: ParticipantCategory): ParticipantRow => ({ category, name: '', position: '', company: '' });

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'APPROVED' || status === 'SETTLED'
      ? 'badge-success'
      : status === 'REJECTED'
      ? 'badge-danger'
      : status === 'PENDING_APPROVAL' || status === 'PENDING_SALES_ADMIN' || status.startsWith('APPROVAL_')
      ? 'badge-warning'
      : 'badge-info';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

function TxnStatusBadge({ status }: { status: ScannedTransactionRow['status'] }) {
  const cls =
    status === 'AUTO_MATCHED' || status === 'MANUAL_MATCHED'
      ? 'badge-success'
      : status === 'REVIEW_REQUIRED'
      ? 'badge-warning'
      : 'badge-info';
  const label = status === 'UNMATCHED' ? 'NOT MATCHED' : status.replace(/_/g, ' ');
  return <span className={`badge ${cls}`}>{label}</span>;
}

// scope: Entertainment menu = every Expense except Flower Bouquet; Flower Bouquet menu = Flower Bouquet only
// (those are raised from an Expense Request, so there is no "New Expense" form there).
export default function ExpensesView({ scope = 'entertainment' }: { scope?: 'entertainment' | 'flower' }) {
  return (
    <Suspense fallback={<SplashLoader message="Loading" />}>
      <ExpensesPageInner scope={scope} />
    </Suspense>
  );
}

function ExpensesPageInner({ scope }: { scope: 'entertainment' | 'flower' }) {
  const { hasRole, hasPermission, user } = useAuth();
  const canActOnBehalf = hasRole('ADMINISTRATOR');
  // expense.create.all/.owndept: key an Expense in on behalf of another user (the requestor
  // stays that user) - all users / only Sales of the caller's own Department(s).
  const canPickRequestor = canActOnBehalf || hasPermission('expense.create.all', 'expense.create.owndept');
  // expense.create.own: own Expense only (default of role SALES, no requestor picker).
  const canCreateOwn = hasRole('SALES') || hasPermission('expense.create.own');
  const canCreate = canCreateOwn || canPickRequestor;
  // Anyone who can't create their own (Admin, Sales Admin...) is only ever an inputter, so a
  // requestor must be picked; a Sales / expense.create.own holder may leave it as themselves.
  const requestorRequired = canActOnBehalf || (canPickRequestor && !canCreateOwn);
  // Corsec (Position CORSEC) raises Expenses from approved Expense Requests instead of the full form.
  const isCorsec = user?.position?.code === 'CORSEC';
  const [showFromRequest, setShowFromRequest] = useState(false);
  const canAutoMatch = canActOnBehalf || hasPermission('expense.automatch');
  const canExport = canActOnBehalf || hasPermission('expense.export');
  const canManualMatch = canActOnBehalf || hasPermission('expense.match.all', 'expense.match.owndept');

  // Filters live in the URL (not just component state) so browser Back from
  // an expense's detail page - which lands on a fresh instance of this page,
  // not a cached one - restores the exact same list instead of resetting to
  // the hardcoded defaults (see expenses/[id]/page.tsx's Back button).
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  // Default view: all statuses, last 1 month - see defaultFromDate/defaultToDate.
  // A stale URL (older raw status values) falls back to All.
  const [status, setStatus] = useState(() => {
    const fromUrl = searchParams.get('statusGroup');
    return STATUS_OPTIONS.some((o) => o.value === fromUrl) ? (fromUrl as string) : ALL_STATUSES_VALUE;
  });
  const [error, setError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [imagesExpenseId, setImagesExpenseId] = useState<string | null>(null);
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [statementPopup, setStatementPopup] = useState<{
    fileName: string;
    matchedTxnId: string;
    lines: StatementLine[];
  } | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState('');

  const [departmentFilter, setDepartmentFilter] = useState(() => searchParams.get('departmentId') ?? '');
  const [fromDate, setFromDate] = useState(() => searchParams.get('fromDate') ?? defaultFromDate());
  const [toDate, setToDate] = useState(() => searchParams.get('toDate') ?? defaultToDate());
  const [matchedFilter, setMatchedFilter] = useState(() => searchParams.get('matched') ?? '');
  // Agency / Advertiser / Amount are typed: the *Input values follow the keystrokes, the applied ones
  // (what is sent to the API and kept in the URL) catch up after a short pause.
  const [unitFilter, setUnitFilter] = useState(() => searchParams.get('requestorUnitId') ?? '');
  const [agencyFilter, setAgencyFilter] = useState(() => searchParams.get('agency') ?? '');
  const [advertiserFilter, setAdvertiserFilter] = useState(() => searchParams.get('advertiser') ?? '');
  const [minAmountFilter, setMinAmountFilter] = useState(() => searchParams.get('minAmount') ?? '');
  const [maxAmountFilter, setMaxAmountFilter] = useState(() => searchParams.get('maxAmount') ?? '');
  const [agencyInput, setAgencyInput] = useState(agencyFilter);
  const [advertiserInput, setAdvertiserInput] = useState(advertiserFilter);
  const [minAmountInput, setMinAmountInput] = useState(minAmountFilter);
  const [maxAmountInput, setMaxAmountInput] = useState(maxAmountFilter);
  const [filterDepartmentOptions, setFilterDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [showAutoMatchModal, setShowAutoMatchModal] = useState(false);
  const [autoMatchFiles, setAutoMatchFiles] = useState<File[]>([]);
  const [autoMatchDepartmentOptions, setAutoMatchDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [autoMatchDepartmentId, setAutoMatchDepartmentId] = useState('');
  const [autoMatchCreditCardOptions, setAutoMatchCreditCardOptions] = useState<CreditCardOption[]>([]);
  const [autoMatchCreditCardId, setAutoMatchCreditCardId] = useState('');
  const [forceRescan, setForceRescan] = useState(false);
  const [showScanResult, setShowScanResult] = useState(true);
  const [scanResultModalOpen, setScanResultModalOpen] = useState(false);
  // Captures the "Show Scan Result" checkbox's value at the moment a run starts
  // (a run outlives this modal and can keep going across page navigation - see
  // AutoMatchProvider), so the popup decision doesn't shift if the checkbox's
  // own state gets reused/reset before the run finishes.
  const wantScanResultRef = useRef(true);
  const wasMatchingRef = useRef(false);
  const {
    running: matching,
    message: matchMessage,
    error: matchError,
    batches: matchedBatches,
    version: matchVersion,
    start: startAutoMatch,
  } = useAutoMatch();

  // Opens the result popup only once a run finishes, and only if the user had
  // "Show Scan Result" checked when they kicked it off - otherwise the table
  // below (refreshed via the matchVersion effect) is the only visible change.
  useEffect(() => {
    if (wasMatchingRef.current && !matching) {
      if (wantScanResultRef.current) setScanResultModalOpen(true);
    }
    wasMatchingRef.current = matching;
  }, [matching]);

  const [salesOptions, setSalesOptions] = useState<SalesOption[]>([]);
  const [onBehalfOfSalesId, setOnBehalfOfSalesId] = useState('');
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [creditCardOptions, setCreditCardOptions] = useState<CreditCardOption[]>([]);
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<PaymentMethodOption[]>([]);
  const [advertiserOptions, setAdvertiserOptions] = useState<AdvertiserOption[]>([]);
  const [agencyOptions, setAgencyOptions] = useState<AgencyOption[]>([]);
  // New/Edit Expense form only: Agencies/Advertisers covered by the Department picked on the form.
  const [formAdvertiserOptions, setFormAdvertiserOptions] = useState<AdvertiserOption[]>([]);
  const [formAgencyOptions, setFormAgencyOptions] = useState<AgencyOption[]>([]);
  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([]);
  const [selectedAgencies, setSelectedAgencies] = useState<AgencyOption[]>([]);
  const [selectedAdvertisers, setSelectedAdvertisers] = useState<AdvertiserOption[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<BrandOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<SimpleOption[]>([]);
  const [activityTypeOptions, setActivityTypeOptions] = useState<SimpleOption[]>([]);

  const [form, setForm] = useState({
    expenseDate: '',
    purpose: '',
    amount: '',
    departmentId: '',
    unitId: '',
    activityTypeId: '',
    paymentMethodId: '',
    paymentMethodNote: '',
    creditCardId: '',
    merchantName: '',
    location: '',
  });
  const [locating, setLocating] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [activityPhotos, setActivityPhotos] = useState<File[]>([]);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrWarnings, setOcrWarnings] = useState<string[]>([]);
  const [ocrRaw, setOcrRaw] = useState<ParsedReceipt | null>(null);
  // The invoice file the current scan belongs to, what that scan filled into the form, and the latest
  // form for async code (see scanInvoice / removeInvoice).
  const ocrFile = useRef<File | null>(null);
  const ocrFilled = useRef<{ merchantName?: string; amount?: string; expenseDate?: string }>({});
  const formRef = useRef(form);
  formRef.current = form;

  // Clicking a totals card narrows the table to that bucket (the cards keep showing every bucket's total).
  const [bucketFilter, setBucketFilter] = useState<TotalsBucket | null>(null);
  const tableRows = bucketFilter ? rows.filter((r) => expenseBucket(r.status) === bucketFilter) : rows;
  const pagination = usePagination(tableRows);

  const buildListParams = () => {
    const params = new URLSearchParams();
    // 'ALL' switches off the API's default (Settled only); a bucket is sent as statusGroup, which the API takes over from status.
    params.set('status', ALL_STATUSES_VALUE);
    if (status !== ALL_STATUSES_VALUE) params.set('statusGroup', status);
    if (departmentFilter) params.set('departmentId', departmentFilter);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    if (matchedFilter) params.set('matched', matchedFilter);
    params.set('activityGroup', scope === 'flower' ? 'FLOWER' : 'NON_FLOWER');
    if (unitFilter) params.set('requestorUnitId', unitFilter);
    if (agencyFilter) params.set('agency', agencyFilter);
    if (advertiserFilter) params.set('advertiser', advertiserFilter);
    if (minAmountFilter) params.set('minAmount', minAmountFilter);
    if (maxAmountFilter) params.set('maxAmount', maxAmountFilter);
    return params;
  };

  const load = () => {
    const qs = buildListParams().toString();
    api
      .get<ExpenseRow[]>(`/expenses${qs ? `?${qs}` : ''}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(() => {
    load();
    // Mirror the same filters into the URL - what makes Back from an expense's
    // detail page land on this exact list again instead of the defaults.
    const qs = buildListParams().toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, departmentFilter, fromDate, toDate, matchedFilter, unitFilter, agencyFilter, advertiserFilter, minAmountFilter, maxAmountFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      setAgencyFilter(agencyInput.trim());
      setAdvertiserFilter(advertiserInput.trim());
      setMinAmountFilter(minAmountInput);
      setMaxAmountFilter(maxAmountInput);
    }, 400);
    return () => clearTimeout(t);
  }, [agencyInput, advertiserInput, minAmountInput, maxAmountInput]);

  const resetFilters = () => {
    setStatus(ALL_STATUSES_VALUE);
    setDepartmentFilter('');
    setFromDate(defaultFromDate());
    setToDate(defaultToDate());
    setMatchedFilter('');
    setBucketFilter(null);
    setUnitFilter('');
    setAgencyFilter('');
    setAdvertiserFilter('');
    setMinAmountFilter('');
    setMaxAmountFilter('');
    setAgencyInput('');
    setAdvertiserInput('');
    setMinAmountInput('');
    setMaxAmountInput('');
  };

  // Bumps every time a file finishes auto-matching (see AutoMatchProvider) - refreshes
  // the table's Matching column live, whether that run started here or on another page,
  // and even if it kept running in the background while the user navigated away.
  const isFirstMatchVersion = useRef(true);
  useEffect(() => {
    if (isFirstMatchVersion.current) {
      isFirstMatchVersion.current = false;
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchVersion]);

  useEffect(() => {
    const path = canActOnBehalf ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setFilterDepartmentOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canActOnBehalf]);

  // Auto Match popup: Department combobox is always the logged-in user's own
  // department(s) - not every department like the ADMIN filter above - since
  // it tags "this statement file came from department X", not who's allowed
  // to see what.
  useEffect(() => {
    if (!showAutoMatchModal) return;
    setAutoMatchDepartmentId('');
    setAutoMatchCreditCardId('');
    api.get<DepartmentOption[]>('/departments/me').then((opts) => {
      setAutoMatchDepartmentOptions(opts);
      if (opts.length === 1) setAutoMatchDepartmentId(opts[0].id);
    }).catch(() => undefined);
  }, [showAutoMatchModal]);

  // Corporate Card combobox narrows to whichever Department is picked above -
  // same "1 Department = 1 credit card" relationship as the Expense form's own
  // Corporate Card dropdown.
  useEffect(() => {
    if (!autoMatchDepartmentId) {
      setAutoMatchCreditCardOptions([]);
      setAutoMatchCreditCardId('');
      return;
    }
    api
      .get<CreditCardOption[]>(`/credit-cards?departmentId=${autoMatchDepartmentId}&active=true`)
      .then((opts) => {
        setAutoMatchCreditCardOptions(opts);
        setAutoMatchCreditCardId((prev) => (opts.some((o) => o.id === prev) ? prev : opts.length === 1 ? opts[0].id : ''));
      })
      .catch(() => undefined);
  }, [autoMatchDepartmentId]);

  const exportExcel = () => {
    const qs = buildListParams().toString();
    downloadFile(`/expenses/export/xlsx${qs ? `?${qs}` : ''}`, 'expenses.xlsx').catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Export failed'),
    );
  };

  // No PDF-generation library on the backend - build a printable table client-side
  // and let the browser's print dialog "Save as PDF" handle the export.
  const exportPdf = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const pdfRows = tableRows
      .map(
        (r) => `<tr>
          <td>${r.expenseNo}</td>
          <td>${formatDate(r.expenseDate)}</td>
          <td>${r.sales?.name ?? ''}</td>
          <td>${r.department?.name ?? ''}</td>
          <td>${r.advertiser?.name ?? ''}</td>
          <td>${r.brand?.name ?? ''}</td>
          <td>${r.purpose}</td>
          <td>${formatCurrency(r.amount)}</td>
          <td>${r.status}</td>
          <td>${isMatched(r) ? 'Matched' : 'Not Matched'}</td>
        </tr>`,
      )
      .join('');
    win.document.write(`<!doctype html><html><head><title>Expenses</title><style>
      body { font-family: sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
    </style></head><body>
      <h3>Expenses</h3>
      <table><thead><tr>
        <th>Expense No</th><th>Date</th><th>Sales</th><th>Department</th><th>Advertiser</th><th>Brand</th>
        <th>Purpose</th><th>Amount</th><th>Status</th><th>Matching</th>
      </tr></thead><tbody>${pdfRows}</tbody></table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  useEffect(() => {
    api.get<AdvertiserOption[]>('/advertisers?active=true').then(setAdvertiserOptions).catch(() => undefined);
    api.get<AgencyOption[]>('/agencies?active=true').then(setAgencyOptions).catch(() => undefined);
    api.get<SimpleOption[]>('/units?active=true').then(setUnitOptions).catch(() => undefined);
    // The scope decides which Activity Types belong to this menu (Flower Bouquet is the Flower Bouquet one).
    api
      .get<SimpleOption[]>('/activity-types?active=true')
      .then((all) => setActivityTypeOptions(all.filter((a) => (a.name === 'Flower Bouquet') === (scope === 'flower'))))
      .catch(() => undefined);
    api.get<PaymentMethodOption[]>('/payment-methods?active=true').then(setPaymentMethodOptions).catch(() => undefined);
  }, []);

  // Agency / Advertiser dropdowns on the form only list what the picked Department covers
  // (Department coverage); nothing picked yet shows them all.
  useEffect(() => {
    // `cancelled` drops a slower, stale response (e.g. the unfiltered one fired before the Department was known).
    let cancelled = false;
    const qs = form.departmentId ? `&departmentIds=${form.departmentId}` : '';
    api.get<AdvertiserOption[]>(`/advertisers?active=true${qs}`).then((r) => !cancelled && setFormAdvertiserOptions(r)).catch(() => undefined);
    api.get<AgencyOption[]>(`/agencies?active=true${qs}`).then((r) => !cancelled && setFormAgencyOptions(r)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [form.departmentId]);

  // 1 Department = 1 credit card - the Corporate Card dropdown only ever lists the card(s)
  // belonging to whichever Department is currently picked on the form.
  useEffect(() => {
    if (!form.departmentId) {
      setCreditCardOptions([]);
      return;
    }
    api.get<CreditCardOption[]>(`/credit-cards?departmentId=${form.departmentId}&active=true`).then(setCreditCardOptions).catch(() => undefined);
  }, [form.departmentId]);

  // Brand options narrow to whichever Advertisers are currently selected above,
  // so Brand always matches Advertiser.
  const selectedAdvertiserIds = selectedAdvertisers.map((a) => a.id).join(',');
  useEffect(() => {
    if (!selectedAdvertiserIds) {
      setBrandOptions([]);
      return;
    }
    api
      .get<BrandOption[]>(`/brands?advertiserIds=${selectedAdvertiserIds}&active=true`)
      .then(setBrandOptions)
      .catch(() => undefined);
  }, [selectedAdvertiserIds]);

  // Department is picked first: the caller's own Department(s) (every active one for Admin /
  // expense.create.all, the API enforces the same). The Requestor list, Corporate Card list and
  // the rest of the form follow the Department picked here.
  useEffect(() => {
    const canAnyDepartment = canActOnBehalf || hasPermission('expense.create.all');
    let cancelled = false;
    api
      .get<DepartmentOption[]>(canAnyDepartment ? '/departments?active=true' : '/departments/me')
      .then((opts) => {
        if (!cancelled) setDepartmentOptions(opts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canActOnBehalf]);

  // Requestors who belong to the picked Department (the caller themself is the "Myself" option).
  const departmentRequestors = salesOptions.filter(
    (s) => s.id !== user?.id && !!form.departmentId && !!s.departmentIds?.includes(form.departmentId),
  );

  const changeDepartment = (departmentId: string) => {
    // Corporate Card belongs to the Department. The requestor stays only while still a member of the
    // new Department; otherwise fall back to Myself / unpicked and re-derive the Unit.
    const keep = !onBehalfOfSalesId || !!salesOptions.find((s) => s.id === onBehalfOfSalesId)?.departmentIds?.includes(departmentId);
    if (!keep) setOnBehalfOfSalesId('');
    setForm((f) => ({ ...f, departmentId, creditCardId: '', unitId: keep ? f.unitId : '' }));
  };

  // Department auto-fills to the caller's first Department once known - still changeable below.
  useEffect(() => {
    if (departmentOptions.length > 0 && !form.departmentId) {
      setForm((f) => (f.departmentId ? f : { ...f, departmentId: departmentOptions[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentOptions]);

  // Unit auto-fills from the Sales's own profile (or the on-behalf-of Sales's profile).
  useEffect(() => {
    const targetUnitId =
      canPickRequestor && onBehalfOfSalesId
        ? salesOptions.find((s) => s.id === onBehalfOfSalesId)?.unitId
        : requestorRequired
          ? undefined
          : user?.unitId;
    if (targetUnitId && !form.unitId) {
      setForm((f) => (f.unitId ? f : { ...f, unitId: targetUnitId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPickRequestor, requestorRequired, onBehalfOfSalesId, salesOptions, user?.unitId]);

  useEffect(() => {
    if (canPickRequestor) {
      api.get<SalesOption[]>('/expenses/requestors').then(setSalesOptions).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPickRequestor]);

  const resetForm = () => {
    ocrFile.current = null;
    ocrFilled.current = {};
    setForm({
      expenseDate: '',
      purpose: '',
      amount: '',
      departmentId: '',
      unitId: '',
      activityTypeId: '',
      paymentMethodId: '',
      paymentMethodNote: '',
      creditCardId: '',
      merchantName: '',
      location: '',
    });
    setItems([]);
    setOnBehalfOfSalesId('');
    setSelectedAgencies([]);
    setSelectedAdvertisers([]);
    setSelectedBrands([]);
    setParticipants([]);
    setActivityPhotos([]);
    setInvoiceFiles([]);
    setOcrScanning(false);
    setOcrWarnings([]);
    setOcrRaw(null);
  };

  // OCR (AWS Textract) only the FIRST invoice picked, right after it's chosen, so
  // the form pre-fills before the Expense/Invoice even exist (this create form is
  // single-shot - nothing is persisted until final submit). Only three values are
  // taken from the receipt and put straight into the form: Merchant, Expense Date
  // (the transaction date) and Amount (the receipt's own Total/Jumlah line -
  // ParsedReceipt.total, never subtotal). A field the user already filled by hand
  // is never overwritten. Later invoices are only attached, never scanned. Best-effort:
  // OCR failures never block manual entry (fail-open). The backend only OCRs
  // images, so a PDF as first invoice is attached without a scan.
  const onInvoiceFilesChange = async (newFiles: File[]) => {
    const isFirstInvoice = invoiceFiles.length === 0;
    setInvoiceFiles((prev) => [...prev, ...newFiles]);

    const firstFile = newFiles[0];
    if (!isFirstInvoice || !firstFile) return;
    await scanInvoice(firstFile);
  };

  const scanInvoice = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    ocrFile.current = file;
    setOcrScanning(true);
    setOcrWarnings([]);
    try {
      const result = (await uploadFile('/invoices/ocr-scan', file)) as ParsedReceipt;
      // The scanned invoice was removed (or replaced) while the scan was running - drop the result.
      if (ocrFile.current !== file) return;
      setOcrRaw(result);
      setOcrWarnings(result.warnings);
      const current = formRef.current;
      const scannedAmount = result.total != null ? String(result.total) : '';
      // Remember exactly what the scan filled in, so removing this invoice can undo just that.
      ocrFilled.current = {
        merchantName: !current.merchantName && result.merchantName ? result.merchantName : undefined,
        amount: !current.amount && scannedAmount ? scannedAmount : undefined,
        expenseDate: !current.expenseDate && result.invoiceDate ? result.invoiceDate : undefined,
      };
      setForm((f) => ({
        ...f,
        merchantName: f.merchantName || result.merchantName || '',
        amount: !f.amount && scannedAmount ? scannedAmount : f.amount,
        expenseDate: !f.expenseDate && result.invoiceDate ? result.invoiceDate : f.expenseDate,
      }));
    } catch (err) {
      if (ocrFile.current === file) setOcrWarnings([err instanceof ApiError ? err.message : `OCR scan failed for ${file.name} - enter invoice details manually.`]);
    } finally {
      if (ocrFile.current === file || ocrFile.current === null) setOcrScanning(false);
    }
  };

  // Removing the first invoice empties Merchant / Expense Date / Amount again - only those still
  // holding the scanned value, so anything typed over since is kept - and the next invoice in line
  // becomes the first one and is scanned in its place.
  const removeInvoice = (index: number) => {
    const rest = invoiceFiles.filter((_, i) => i !== index);
    setInvoiceFiles(rest);
    if (index !== 0) return;
    const filled = ocrFilled.current;
    const current = formRef.current;
    ocrFilled.current = {};
    ocrFile.current = null;
    setOcrRaw(null);
    setOcrWarnings([]);
    setForm((f) => ({
      ...f,
      merchantName: filled.merchantName !== undefined && current.merchantName === filled.merchantName ? '' : f.merchantName,
      amount: filled.amount !== undefined && current.amount === filled.amount ? '' : f.amount,
      expenseDate: filled.expenseDate !== undefined && current.expenseDate === filled.expenseDate ? '' : f.expenseDate,
    }));
    if (rest[0]) void scanInvoice(rest[0]);
  };

  const addAgency = (agencyId: string) => {
    const a = formAgencyOptions.find((x) => x.id === agencyId);
    if (a) setSelectedAgencies((prev) => (prev.some((s) => s.id === a.id) ? prev : [...prev, a]));
  };
  const removeAgency = (agencyId: string) => setSelectedAgencies((prev) => prev.filter((a) => a.id !== agencyId));

  const addAdvertiser = (advertiserId: string) => {
    const a = formAdvertiserOptions.find((x) => x.id === advertiserId);
    if (a) setSelectedAdvertisers((prev) => (prev.some((s) => s.id === a.id) ? prev : [...prev, a]));
  };
  const removeAdvertiser = (advertiserId: string) => setSelectedAdvertisers((prev) => prev.filter((a) => a.id !== advertiserId));

  const toggleBrand = (brand: BrandOption) =>
    setSelectedBrands((prev) =>
      prev.some((b) => b.id === brand.id) ? prev.filter((b) => b.id !== brand.id) : [...prev, brand],
    );
  const removeBrand = (brandId: string) => setSelectedBrands((prev) => prev.filter((b) => b.id !== brandId));

  const addParticipant = (category: ParticipantCategory) => setParticipants((prev) => [...prev, emptyParticipant(category)]);
  const updateParticipant = (index: number, patch: Partial<ParticipantRow>) =>
    setParticipants((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const removeParticipant = (index: number) => setParticipants((prev) => prev.filter((_, i) => i !== index));

  // Which of the two submit buttons ("Save as Draft" / "Submit") fired the form -
  // set from the button's onClick, which runs before the form's submit event.
  const submitIsDraftRef = useRef(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const isDraft = submitIsDraftRef.current;
    // "Save as Draft" skips the browser's `required` checks (formNoValidate) and every check
    // below: a draft may hold nothing but an uploaded/scanned invoice, the rest is filled in
    // later (the API defaults Unit / Activity Type and re-checks it all when the draft is
    // submitted). Only Submit enforces them.
    if (!isDraft) {
      if (!form.expenseDate || !form.purpose.trim() || !form.amount) {
        setError('Expense Date, Purpose and Amount are required.');
        return;
      }
      if (!primaryAdvertiserId || !primaryBrandId || !form.unitId || !form.activityTypeId) {
        setError('Advertiser, Brand, Unit and Activity Type must all be picked.');
        return;
      }
      if (activityPhotos.length === 0) {
        setError('Foto Kegiatan is required - upload at least one photo.');
        return;
      }
      if (invoiceFiles.length === 0) {
        setError('Foto Invoice is required - upload at least one invoice / receipt.');
        return;
      }
      if (!form.paymentMethodId) {
        setError('Payment Method is required.');
        return;
      }
      if (selectedPaymentMethodCode === 'CORPORATE_CARD' && !form.creditCardId) {
        setError('Corporate Card is required.');
        return;
      }
    }
    setSaving(true);
    setSavingDraft(isDraft);
    setError('');
    try {
      const selectedPaymentMethod = paymentMethodOptions.find((m) => m.id === form.paymentMethodId);
      const payload: Record<string, unknown> = {
        ...form,
        // Empty fields of a draft are left out (not sent as '') so the API applies its defaults.
        expenseDate: form.expenseDate || todayIso(),
        unitId: form.unitId || undefined,
        activityTypeId: form.activityTypeId || undefined,
        amount: Number(form.amount) || 0,
        departmentId: form.departmentId || undefined,
        creditCardId: selectedPaymentMethod?.code === 'CORPORATE_CARD' ? form.creditCardId || undefined : undefined,
        paymentMethodId: form.paymentMethodId || undefined,
        paymentMethodNote: form.paymentMethodNote || undefined,
        advertiserId: primaryAdvertiserId,
        brandId: primaryBrandId,
        // A new Expense enters the approval chain on create unless isDraft is set.
        isDraft,
      };
      if (canPickRequestor && onBehalfOfSalesId) payload.salesId = onBehalfOfSalesId;

      const validItems = items
        .filter((it) => it.description.trim() && it.price)
        .map((it) => ({ description: it.description, amount: itemSubtotal(it), categoryId: it.categoryId || undefined }));
      if (validItems.length > 0) payload.items = validItems;

      // Agency has no single mandatory field on Expense, so every picked Agency goes in.
      if (selectedAgencies.length > 0) payload.extraAgencyIds = selectedAgencies.map((a) => a.id);
      // Advertiser/Brand DO have a mandatory "primary" field (the first pick) -
      // only send the *additional* ones here so the primary isn't duplicated
      // into the extra-join table.
      const extraAdvertiserIds = selectedAdvertisers.filter((a) => a.id !== primaryAdvertiserId).map((a) => a.id);
      if (extraAdvertiserIds.length > 0) payload.extraAdvertiserIds = extraAdvertiserIds;
      const extraBrandIds = selectedBrands.filter((b) => b.id !== primaryBrandId).map((b) => b.id);
      if (extraBrandIds.length > 0) payload.extraBrandIds = extraBrandIds;

      const validParticipants = participants
        .filter((p) => p.name.trim())
        .map((p) => ({ category: p.category, name: p.name, position: p.position || undefined, company: p.company || undefined }));
      if (validParticipants.length > 0) payload.participants = validParticipants;

      const created = await api.post<{ id: string }>('/expenses', payload);

      for (const file of activityPhotos) {
        await uploadFile(`/expenses/${created.id}/photos`, file);
      }

      if (invoiceFiles.length > 0) {
        const invoicePayload: Record<string, unknown> = {};
        if (ocrRaw) {
          invoicePayload.ocrMerchantName = ocrRaw.merchantName ?? undefined;
          invoicePayload.ocrSubtotal = ocrRaw.subtotal ?? undefined;
          invoicePayload.ocrTax = ocrRaw.tax ?? undefined;
          invoicePayload.ocrServiceCharge = ocrRaw.serviceCharge ?? undefined;
          invoicePayload.ocrTotal = ocrRaw.total ?? undefined;
          invoicePayload.ocrConfidence = ocrRaw.confidence ?? undefined;
        }
        if (form.merchantName) invoicePayload.finalMerchantName = form.merchantName;
        invoicePayload.finalTotal = Number(form.amount);

        const invoice = await api.post<{ id: string }>(`/expenses/${created.id}/invoices`, invoicePayload);
        for (const file of invoiceFiles) {
          await uploadFile(`/invoices/${invoice.id}/files`, file);
        }
      }

      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const resendApprovalEmail = async (expenseId: string) => {
    setResendingId(expenseId);
    setError('');
    try {
      await api.post(`/expenses/${expenseId}/resend-approval-email`);
      toast.success('Reminder email has been sent to the current approver.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resend approval email');
    } finally {
      setResendingId(null);
    }
  };

  const deleteDraft = async (row: ExpenseRow) => {
    const ok = await confirm({
      title: 'Delete draft?',
      message: `Draft ${row.expenseNo} will be permanently deleted. This cannot be undone.`,
      danger: true,
    });
    if (!ok) return;
    setDeletingId(row.id);
    setError('');
    try {
      await api.del(`/expenses/${row.id}`);
      toast.success('Draft deleted.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete draft');
    } finally {
      setDeletingId(null);
    }
  };

  const manualMatch = async (expenseId: string) => {
    setMatchingId(expenseId);
    setError('');
    try {
      await api.post(`/bank-settlements/expenses/${expenseId}/manual-match`);
      const expenseNo = rows.find((r) => r.id === expenseId)?.expenseNo;
      toast.success(expenseNo ? `${expenseNo} has been marked as Matched.` : 'Expense has been marked as Matched.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Match failed');
    } finally {
      setMatchingId(null);
    }
  };

  const openImages = (expenseId: string) => setImagesExpenseId(expenseId);

  const openStatementPopup = async (txn: BankTransactionRef) => {
    setStatementModalOpen(true);
    setStatementError('');
    setStatementLoading(true);
    setStatementPopup(null);
    try {
      const batch = await api.get<{ transactions: StatementLine[] }>(`/bank-settlements/${txn.batchId}`);
      setStatementPopup({
        fileName: txn.batch.fileName,
        matchedTxnId: txn.id,
        lines: [...batch.transactions].sort((a, b) => a.lineNo - b.lineNo),
      });
    } catch (err) {
      setStatementError(err instanceof ApiError ? err.message : 'Failed to load statement detail');
    } finally {
      setStatementLoading(false);
    }
  };

  const noSalesReason = requestorRequired && !onBehalfOfSalesId ? 'Pick a requestor to fill in this expense on their behalf.' : null;
  // Advertiser/Brand have no single inherited value anymore (Pre-Event is retired) -
  // the first entry picked in the Advertiser/Brand lists below becomes the primary
  // (mandatory) one, the rest are "additional".
  const primaryAdvertiserId = selectedAdvertisers[0]?.id;
  const primaryBrandId = selectedBrands[0]?.id;
  const selectedPaymentMethodCode = paymentMethodOptions.find((m) => m.id === form.paymentMethodId)?.code;

  return (
    <div>
      <div className="toolbar">
        <h1>{scope === 'flower' ? 'Flower Bouquet Expenses' : 'Entertainment'}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {canAutoMatch && (
            <button className="btn" onClick={() => setShowAutoMatchModal(true)}>
              <NavIcon name="search" /> Auto Match
            </button>
          )}
          {canExport && (
            <button className="btn" onClick={exportExcel}>
              Export to Excel
            </button>
          )}
          {canExport && (
            <button className="btn" onClick={exportPdf}>
              Export to PDF
            </button>
          )}
          {isCorsec && (
            <button className="btn btn-primary" onClick={() => setShowFromRequest(true)}>
              + New Expense from Request
            </button>
          )}
          {canCreate && !isCorsec && scope !== 'flower' && (
            <button
              className="btn btn-primary"
              onClick={() => {
                if (showForm) resetForm();
                setShowForm((v) => !v);
              }}
            >
              {showForm ? 'Cancel' : '+ New Expense'}
            </button>
          )}
        </div>
      </div>

      <TransactionTotalsCards
        totals={sumByBucket(rows, (r) => expenseBucket(r.status), (r) => r.amount)}
        selected={bucketFilter}
        onSelect={setBucketFilter}
      />

      <div className="toolbar" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} style={{ width: 200 }}>
            <option value="">{canActOnBehalf ? 'All Department' : 'All my Departments'}</option>
            {filterDepartmentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 220 }}>
            <option value={ALL_STATUSES_VALUE}>All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
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
          <select value={matchedFilter} onChange={(e) => setMatchedFilter(e.target.value)} style={{ width: 160 }}>
            <option value="">Matched/Not Matched</option>
            <option value="MATCHED">Matched</option>
            <option value="UNMATCHED">Not Matched</option>
          </select>
          <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} style={{ width: 170 }}>
            <option value="">All Units (requestor)</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            list="expense-filter-agencies"
            placeholder="Search agency..."
            value={agencyInput}
            onChange={(e) => setAgencyInput(e.target.value)}
            style={{ width: 170 }}
          />
          <datalist id="expense-filter-agencies">
            {agencyOptions.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
          <input
            list="expense-filter-advertisers"
            placeholder="Search advertiser..."
            value={advertiserInput}
            onChange={(e) => setAdvertiserInput(e.target.value)}
            style={{ width: 170 }}
          />
          <datalist id="expense-filter-advertisers">
            {advertiserOptions.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
          <NumberInput placeholder="Min amount" value={minAmountInput} onChange={setMinAmountInput} style={{ width: 140 }} />
          <NumberInput placeholder="Max amount" value={maxAmountInput} onChange={setMaxAmountInput} style={{ width: 140 }} />
          <button type="button" className="btn" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </div>

      {showFromRequest && (
        <ExpenseFromRequestModal
          onClose={() => setShowFromRequest(false)}
          onCreated={() => {
            setShowFromRequest(false);
            toast.success('Expense created and sent to the Sales Admin for completion.');
            load();
          }}
        />
      )}

      {scanResultModalOpen && !matching && (matchedBatches.length > 0 || matchError) && (
        <Modal title="Scan Result" onClose={() => setScanResultModalOpen(false)} wide>
          {matchMessage && (
            <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>
              {matchMessage}
            </div>
          )}
          {matchError && <div className="error-text" style={{ marginBottom: 12 }}>{matchError}</div>}
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Matched Expense</th>
              </tr>
            </thead>
            <tbody>
              {matchedBatches.flatMap((b) =>
                b.transactions.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {b.fileName}
                    {b.alreadyScanned && <span title="Sudah pernah discan sebelumnya"> (lama)</span>}
                  </td>
                    <td>{formatDate(t.transactionDate)}</td>
                    <td style={{ maxWidth: 220 }}>{t.rawDescription}</td>
                    <td>{formatCurrency(t.amount)}</td>
                    <td>
                      <TxnStatusBadge status={t.status} />
                    </td>
                    <td>
                      {t.matchedExpense ? (
                        <span style={{ fontSize: 12 }}>
                          {t.matchedExpense.expenseNo} {t.matchedExpense.sales ? `(${t.matchedExpense.sales.name})` : ''}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                )),
              )}
              {matchedBatches.every((b) => b.transactions.length === 0) && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    No transactions parsed from the uploaded file(s)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}
      {showAutoMatchModal && (
        <Modal title="Auto Match — Upload Bank Settlement PDF" onClose={() => setShowAutoMatchModal(false)}>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
            Upload one or more bank/credit-card settlement PDFs. They&apos;ll be scanned and matched against expenses in the
            background — you can keep working while it runs.
          </p>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            Department
            <select
              value={autoMatchDepartmentId}
              onChange={(e) => setAutoMatchDepartmentId(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 2 }}
            >
              <option value="">Select department...</option>
              {autoMatchDepartmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            Corporate Card
            <select
              value={autoMatchCreditCardId}
              onChange={(e) => setAutoMatchCreditCardId(e.target.value)}
              disabled={!autoMatchDepartmentId}
              style={{ display: 'block', width: '100%', marginTop: 2 }}
            >
              <option value="">Select corporate card...</option>
              {autoMatchCreditCardOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bank} •••• {c.last4}
                </option>
              ))}
            </select>
          </label>
          <input
            type="file"
            accept="application/pdf"
            multiple
            style={{ marginTop: 8 }}
            onChange={(e) => setAutoMatchFiles(Array.from(e.target.files || []))}
          />
          {autoMatchFiles.length > 0 && (
            <ul style={{ fontSize: 12, color: 'var(--muted)' }}>
              {autoMatchFiles.map((f, i) => (
                <li key={`${f.name}-${i}`}>{f.name}</li>
              ))}
            </ul>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            <input type="checkbox" checked={forceRescan} onChange={(e) => setForceRescan(e.target.checked)} style={{ width: 'auto' }} />
            Scan ulang meski file sudah pernah discan
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            <input
              type="checkbox"
              checked={showScanResult}
              onChange={(e) => setShowScanResult(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Show Scan Result
          </label>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={autoMatchFiles.length === 0 || !autoMatchDepartmentId || matching}
            onClick={() => {
              const files = autoMatchFiles;
              const departmentId = autoMatchDepartmentId;
              const creditCardId = autoMatchCreditCardId;
              wantScanResultRef.current = showScanResult;
              setScanResultModalOpen(false);
              setShowAutoMatchModal(false);
              setAutoMatchFiles([]);
              startAutoMatch(files, forceRescan, departmentId, creditCardId);
            }}
          >
            {matching ? 'A match is already running...' : 'Upload & Match'}
          </button>
        </Modal>
      )}

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <div className="form-row" style={{ maxWidth: 360 }}>
            <label>{canPickRequestor ? 'Department *' : 'Department'}</label>
            <select required={canPickRequestor} value={form.departmentId} onChange={(e) => changeDepartment(e.target.value)}>
              <option value="">{canPickRequestor ? 'Select department' : '- (optional)'}</option>
              {departmentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {canPickRequestor && (
            <div className="form-row" style={{ maxWidth: 360 }}>
              <label>{requestorRequired ? 'Requestor (entry on behalf of) *' : 'Requestor'}</label>
              <select
                value={onBehalfOfSalesId}
                disabled={!form.departmentId}
                onChange={(e) => {
                  setOnBehalfOfSalesId(e.target.value);
                  // Unit follows the requestor - re-derive it.
                  setForm((f) => ({ ...f, unitId: '' }));
                }}
              >
                <option value="">
                  {!form.departmentId ? 'Select a Department first' : requestorRequired ? 'Select requestor' : `Myself (${user?.name ?? ''})`}
                </option>
                {departmentRequestors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.employeeId})
                  </option>
                ))}
              </select>
              {requestorRequired && form.departmentId && departmentRequestors.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>No requestor available in this department.</span>
              )}
            </div>
          )}

          {noSalesReason ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>{noSalesReason}</div>
          ) : (
            <>
              <div className="form-grid">
                <div className="form-row">
                  <label>Unit *</label>
                  <select required value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                    <option value="">Select unit</option>
                    {unitOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>Activity Type *</label>
                  <select required value={form.activityTypeId} onChange={(e) => setForm({ ...form, activityTypeId: e.target.value })}>
                    <option value="">Select activity</option>
                    {activityTypeOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>Expense Date *</label>
                  <DatePicker required value={form.expenseDate} onChange={(v) => setForm({ ...form, expenseDate: v })} />
                </div>
                <div className="form-row">
                  <label>Amount (IDR) *</label>
                  <NumberInput required allowDecimals value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
                </div>
                <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                  <label>Purpose *</label>
                  <input required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Merchant</label>
                  <input value={form.merchantName} onChange={(e) => setForm({ ...form, merchantName: e.target.value })} placeholder="e.g. restaurant/venue name" />
                </div>
                <div className="form-row">
                  <label>Location</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      placeholder="Address or coordinates"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={locating}
                      title="Use my current location"
                      onClick={() => {
                        if (!navigator.geolocation) {
                          setError('Geolocation is not supported by this browser.');
                          return;
                        }
                        setLocating(true);
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            setForm((f) => ({ ...f, location: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` }));
                            setLocating(false);
                          },
                          () => {
                            setError('Could not get your location - check browser permission.');
                            setLocating(false);
                          },
                        );
                      }}
                    >
                      {locating ? '...' : '📍'}
                    </button>
                  </div>
                </div>
                <div className="form-row">
                  <label>Payment Method *</label>
                  <select
                    required
                    value={form.paymentMethodId}
                    onChange={(e) => setForm({ ...form, paymentMethodId: e.target.value, creditCardId: '', paymentMethodNote: '' })}
                  >
                    <option value="">Select...</option>
                    {paymentMethodOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedPaymentMethodCode === 'CORPORATE_CARD' && (
                  <div className="form-row">
                    <label>Corporate Card *</label>
                    <select
                      required
                      disabled={!form.departmentId}
                      value={form.creditCardId}
                      onChange={(e) => setForm({ ...form, creditCardId: e.target.value })}
                    >
                      <option value="">{form.departmentId ? 'Select card' : 'Select a Department first'}</option>
                      {creditCardOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.bank} •••• {c.last4} ({c.user?.name ?? '-'})
                        </option>
                      ))}
                    </select>
                    {!form.departmentId && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Select a Department first.</span>}
                  </div>
                )}
                {selectedPaymentMethodCode && selectedPaymentMethodCode !== 'CORPORATE_CARD' && (
                  <div className="form-row">
                    <label style={{ fontSize: 12 }}>Note (optional)</label>
                    <input
                      value={form.paymentMethodNote}
                      onChange={(e) => setForm({ ...form, paymentMethodNote: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>Agency (bisa lebih dari 1)</label>
                  {selectedAgencies.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {selectedAgencies.map((a) => (
                        <span key={a.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {a.name}
                          <button
                            type="button"
                            onClick={() => removeAgency(a.id)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit' }}
                            aria-label={`Remove ${a.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="form-row" style={{ maxWidth: 360 }}>
                    <select value="" onChange={(e) => e.target.value && addAgency(e.target.value)}>
                      <option value="">+ Add an agency</option>
                      {formAgencyOptions
                        .filter((a) => !selectedAgencies.some((s) => s.id === a.id))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    Advertiser * (bisa lebih dari 1) — pilihan pertama jadi primary
                  </label>
                  {selectedAdvertisers.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {selectedAdvertisers.map((a, i) => (
                        <span key={a.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {a.name}
                          {i === 0 && <span style={{ fontSize: 10, opacity: 0.8 }}>(primary)</span>}
                          <button
                            type="button"
                            onClick={() => removeAdvertiser(a.id)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit' }}
                            aria-label={`Remove ${a.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="form-row" style={{ maxWidth: 360 }}>
                    <select value="" onChange={(e) => e.target.value && addAdvertiser(e.target.value)}>
                      <option value="">+ Add an advertiser</option>
                      {formAdvertiserOptions
                        .filter((a) => !selectedAdvertisers.some((s) => s.id === a.id))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    Brand * (bisa lebih dari 1, berdasarkan Advertiser di atas) — pilihan pertama jadi primary
                  </label>
                  {selectedBrands.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {selectedBrands.map((b, i) => (
                        <span key={b.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {b.name}
                          {i === 0 && <span style={{ fontSize: 10, opacity: 0.8 }}>(primary)</span>}
                          <button
                            type="button"
                            onClick={() => removeBrand(b.id)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit' }}
                            aria-label={`Remove ${b.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {selectedAdvertisers.length === 0 ? (
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>Select an Advertiser above to pick its brands.</span>
                  ) : (
                    <div
                      className="check-grid"
                      style={{
                        maxHeight: 200,
                        overflowY: 'auto',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      {brandOptions.map((b) => (
                        <label key={b.id} className="check-item">
                          <input type="checkbox" checked={selectedBrands.some((sb) => sb.id === b.id)} onChange={() => toggleBrand(b)} />
                          {b.name}
                        </label>
                      ))}
                      {brandOptions.length === 0 && (
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>No brands under the selected advertiser(s)</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={{ display: 'block', marginBottom: 8 }}>Participants (optional)</label>
                {PARTICIPANT_SECTIONS.map((section) => (
                  <div key={section.category} style={{ marginBottom: 12 }}>
                    <div className="toolbar" style={{ marginBottom: 8 }}>
                      <label style={{ margin: 0, fontSize: 13 }}>{section.label}</label>
                      <button type="button" className="btn" onClick={() => addParticipant(section.category)}>
                        + Add {section.label}
                      </button>
                    </div>
                    {participants.map((p, i) =>
                      p.category === section.category ? (
                        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                          <input
                            placeholder="Name"
                            value={p.name}
                            onChange={(e) => updateParticipant(i, { name: e.target.value })}
                            style={{ flex: 2 }}
                          />
                          <input
                            placeholder="Jabatan / Position"
                            value={p.position}
                            onChange={(e) => updateParticipant(i, { position: e.target.value })}
                            style={{ flex: 1 }}
                          />
                          {section.category === 'EMPLOYEE' ? (
                            <input
                              placeholder="Company (optional)"
                              value={p.company}
                              onChange={(e) => updateParticipant(i, { company: e.target.value })}
                              style={{ flex: 1 }}
                            />
                          ) : p.companyOther ? (
                            <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                              <input
                                placeholder="Type company name"
                                value={p.company}
                                onChange={(e) => updateParticipant(i, { company: e.target.value })}
                                style={{ flex: 1 }}
                              />
                              <button
                                type="button"
                                className="btn"
                                title="Back to list"
                                onClick={() => updateParticipant(i, { company: '', companyOther: false })}
                              >
                                ↩
                              </button>
                            </div>
                          ) : (
                            <select
                              value={p.company}
                              onChange={(e) =>
                                e.target.value === OTHERS_COMPANY
                                  ? updateParticipant(i, { company: '', companyOther: true })
                                  : updateParticipant(i, { company: e.target.value })
                              }
                              style={{ flex: 1 }}
                            >
                              <option value="">Company (optional)</option>
                              {(section.category === 'AGENCY' ? selectedAgencies : selectedAdvertisers).map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                              <option value={OTHERS_COMPANY}>Others...</option>
                            </select>
                          )}
                          <button type="button" className="btn btn-danger" onClick={() => removeParticipant(i)}>
                            Remove
                          </button>
                        </div>
                      ) : null,
                    )}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={{ display: 'block', marginBottom: 8 }}>Upload Foto Kegiatan * (bisa lebih dari 1)</label>
                <FileOrCameraInput
                  accept="image/jpeg,image/png,image/webp"
                  cameraTitle="Foto Kegiatan"
                  onFiles={(files) => setActivityPhotos((prev) => [...prev, ...files])}
                />
                {activityPhotos.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {activityPhotos.map((f, i) => (
                      <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setActivityPhotos((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Upload Foto Invoice / Receipt * (image/pdf, bisa lebih dari 1) — invoice pertama (JPEG/PNG/WebP)
                  di-scan otomatis pakai OCR untuk mengisi Merchant, Expense Date dan Amount
                </label>
                <FileOrCameraInput
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  cameraTitle="Scan Invoice"
                  disabled={ocrScanning}
                  onFiles={onInvoiceFilesChange}
                />
                {invoiceFiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {invoiceFiles.map((f, i) => (
                      <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => removeInvoice(i)} />
                    ))}
                  </div>
                )}
                {ocrScanning && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Scanning receipt...</div>}
                {ocrWarnings.map((w, i) => (
                  <div key={i} className="error-text" style={{ fontSize: 12, marginTop: 4 }}>
                    {w}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              className="btn"
              type="submit"
              formNoValidate
              disabled={saving || ocrScanning || !!noSalesReason}
              onClick={() => {
                submitIsDraftRef.current = true;
              }}
            >
              {saving && savingDraft ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={saving || !!noSalesReason || !form.expenseDate}
              onClick={() => {
                submitIsDraftRef.current = false;
              }}
            >
              {saving && !savingDraft ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Expense No</th>
              <th>Date</th>
              <th>Department</th>
              <th>Agency</th>
              <th>Advertiser</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Matching</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((r) => {
              const canEdit =
                EDITABLE_STATUSES.includes(r.status) &&
                (r.salesId === user?.id || canActOnBehalf || (r.status === 'PENDING_SALES_ADMIN' && hasRole('SALES_ADMIN')));
              const canDeleteDraft =
                r.status === 'DRAFT' && hasPermission('expense.draft.delete.own') && (r.createdById ?? r.salesId) === user?.id;
              const canResend = isPendingApprovalStatus(r.status) && (r.salesId === user?.id || canActOnBehalf);
              const matched = isMatched(r);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/expenses/${r.id}`}>{r.expenseNo}</Link>
                  </td>
                  <td>{formatDate(r.expenseDate)}</td>
                  <td>{r.department?.name || '-'}</td>
                  <td>{agencyNames(r)}</td>
                  <td>{r.advertiser?.name}</td>
                  <td>{formatCurrency(r.amount)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <span className={`badge ${matched ? 'badge-success' : 'badge-info'}`}>{matched ? 'Matched' : 'Not Matched'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {canEdit && (
                        <Link href={`/expenses/${r.id}`} className="btn btn-xs">
                          Edit
                        </Link>
                      )}
                      {canDeleteDraft && (
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          disabled={deletingId === r.id}
                          onClick={() => deleteDraft(r)}
                          title="Delete this draft"
                        >
                          {deletingId === r.id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                      {canResend && (
                        <button
                          type="button"
                          className="btn btn-xs"
                          disabled={resendingId === r.id}
                          onClick={() => resendApprovalEmail(r.id)}
                          title="Resend the approval reminder email to the current approver"
                        >
                          {resendingId === r.id ? 'Sending...' : 'Resend'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-xs btn-icon-xs"
                        onClick={() => openImages(r.id)}
                        title="View activity and invoice photos"
                        aria-label="View activity and invoice photos"
                      >
                        <NavIcon name="eye" />
                      </button>
                      {canManualMatch && !matched && !isSettlementSubmitted(r) && (
                        <button
                          type="button"
                          className="btn btn-xs btn-icon-xs"
                          disabled={matchingId === r.id}
                          onClick={() => manualMatch(r.id)}
                          title={matchingId === r.id ? 'Matching...' : 'Manually mark this expense as Matched'}
                          aria-label="Manually mark this expense as Matched"
                        >
                          <NavIcon name="link" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--muted)' }}>No expenses</td>
              </tr>
            )}
          </tbody>
        </table>
        {tableRows.length > 0 && (
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

      {imagesExpenseId && <ExpenseImagesModal expenseId={imagesExpenseId} onClose={() => setImagesExpenseId(null)} />}

      {statementModalOpen && (
        <Modal title="Statement Transaction" onClose={() => setStatementModalOpen(false)} wide>
          {statementLoading && <div>Loading...</div>}
          {!statementLoading && statementError && <div className="error-text">{statementError}</div>}
          {!statementLoading && statementPopup && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>File</span>
                <div>{statementPopup.fileName}</div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statementPopup.lines.map((line) => {
                    const isCurrent = line.id === statementPopup.matchedTxnId;
                    return (
                      <tr
                        key={line.id}
                        title={isCurrent ? 'This is the scanned row matched to the current expense' : undefined}
                        style={isCurrent ? { background: 'var(--success-bg, #dcfce7)', fontWeight: 600 } : undefined}
                      >
                        <td>{line.lineNo}</td>
                        <td>{line.transactionDate ? formatDate(line.transactionDate) : '-'}</td>
                        <td>{line.rawDescription}</td>
                        <td>{formatCurrency(line.amount)}</td>
                      </tr>
                    );
                  })}
                  {statementPopup.lines.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ color: 'var(--muted)' }}>No lines scanned from this statement</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
