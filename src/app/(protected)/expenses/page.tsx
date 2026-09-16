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
import SearchBox from '@/components/SearchBox';
import LocalFileThumb from '@/components/LocalFileThumb';
import Modal from '@/components/Modal';
import ZoomableImage from '@/components/ZoomableImage';
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

interface BankTransactionRef {
  id: string;
  status: string;
  batchId: string;
  batch: { id: string; fileName: string };
}

interface ExpenseRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  purpose: string;
  amount: string;
  status: string;
  salesId: string;
  sales: { name: string };
  advertiser: { name: string };
  brand: { name: string };
  department: { id: string; name: string } | null;
  bankTransactions: BankTransactionRef[];
  isMatched: boolean;
}

// Expense.isMatched is the source of truth (also true for a manual match with no
// billing-statement transaction at all - e.g. e-wallet/personal reimbursement) -
// don't re-derive it from bankTransactions, which is empty in that case.
function isMatched(row: { isMatched: boolean }) {
  return row.isMatched;
}

function matchedTransaction(row: { bankTransactions: BankTransactionRef[] }) {
  return row.bankTransactions.find((t) => MATCHED_TXN_STATUSES.includes(t.status)) || null;
}

const EDITABLE_STATUSES = ['DRAFT', 'REJECTED', 'REVISION'];

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
}

interface CategoryOption {
  id: string;
  name: string;
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
  cardHolderName: string;
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

const STATUS_OPTIONS = [
  'DRAFT',
  'APPROVAL_HEAD_POD',
  'APPROVAL_KOORDINATOR',
  'APPROVAL_SUPERVISOR',
  'APPROVAL_DEPT_HEAD',
  'APPROVAL_DIV_HEAD',
  'APPROVAL_BOD',
  'PENDING_APPROVAL',
  'REJECTED',
  'REVISION',
  'SETTLED',
];
const ALL_STATUSES_VALUE = 'ALL';
const emptyItem = (): ItemRow => ({ description: '', price: '', qty: '1', categoryId: '' });
const itemSubtotal = (item: ItemRow) => (Number(item.price) || 0) * (Number(item.qty) || 0);
const emptyParticipant = (category: ParticipantCategory): ParticipantRow => ({ category, name: '', position: '', company: '' });

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'APPROVED' || status === 'SETTLED'
      ? 'badge-success'
      : status === 'REJECTED'
      ? 'badge-danger'
      : status === 'PENDING_APPROVAL' || status.startsWith('APPROVAL_')
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

function LocalFileZoom({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file.type.startsWith('image/')) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <NavIcon name="file" /> {file.name}
        </span>
        <div style={{ fontSize: 12, marginTop: 4 }}>PDF — no inline zoom preview, open the thumbnail above to view.</div>
      </div>
    );
  }
  if (!url) return <div style={{ color: 'var(--muted)' }}>Loading...</div>;
  return <ZoomableImage src={url} alt={file.name} />;
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ExpensesPageInner />
    </Suspense>
  );
}

function ExpensesPageInner() {
  const { hasRole, hasPermission, user } = useAuth();
  const canActOnBehalf = hasRole('ADMIN', 'FINANCE');
  const canCreate = hasRole('SALES') || canActOnBehalf || hasPermission('expense.create');
  const canAutoMatch = canActOnBehalf || hasPermission('expense.automatch');
  const canExport = canActOnBehalf || hasPermission('expense.export');

  // Filters live in the URL (not just component state) so browser Back from
  // an expense's detail page - which lands on a fresh instance of this page,
  // not a cached one - restores the exact same list instead of resetting to
  // the hardcoded defaults (see expenses/[id]/page.tsx's Back button).
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  // Default view: all statuses, last 1 month - see defaultFromDate/defaultToDate.
  const [status, setStatus] = useState(() => searchParams.get('status') ?? ALL_STATUSES_VALUE);
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [departmentFilter, setDepartmentFilter] = useState(() => searchParams.get('departmentId') ?? '');
  const [fromDate, setFromDate] = useState(() => searchParams.get('fromDate') ?? defaultFromDate());
  const [toDate, setToDate] = useState(() => searchParams.get('toDate') ?? defaultToDate());
  const [matchedFilter, setMatchedFilter] = useState(() => searchParams.get('matched') ?? '');
  const [filterDepartmentOptions, setFilterDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [showAutoMatchModal, setShowAutoMatchModal] = useState(false);
  const [autoMatchFiles, setAutoMatchFiles] = useState<File[]>([]);
  const [forceRescan, setForceRescan] = useState(false);
  const {
    running: matching,
    message: matchMessage,
    error: matchError,
    batches: matchedBatches,
    version: matchVersion,
    start: startAutoMatch,
  } = useAutoMatch();

  const [salesOptions, setSalesOptions] = useState<SalesOption[]>([]);
  const [onBehalfOfSalesId, setOnBehalfOfSalesId] = useState('');
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [creditCardOptions, setCreditCardOptions] = useState<CreditCardOption[]>([]);
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<PaymentMethodOption[]>([]);
  const [advertiserOptions, setAdvertiserOptions] = useState<AdvertiserOption[]>([]);
  const [agencyOptions, setAgencyOptions] = useState<AgencyOption[]>([]);
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
  const [invoiceForm, setInvoiceForm] = useState({ merchantName: '', subtotal: '', tax: '', serviceCharge: '', discount: '', total: '' });
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [previewFileIndex, setPreviewFileIndex] = useState(0);

  const pagination = usePagination(rows);

  const buildListParams = () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    if (departmentFilter) params.set('departmentId', departmentFilter);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    if (matchedFilter) params.set('matched', matchedFilter);
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
  }, [status, search, departmentFilter, fromDate, toDate, matchedFilter]);

  const resetFilters = () => {
    setStatus(ALL_STATUSES_VALUE);
    setSearch('');
    setSearchInput('');
    setDepartmentFilter('');
    setFromDate(defaultFromDate());
    setToDate(defaultToDate());
    setMatchedFilter('');
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
    const tableRows = rows
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
      </tr></thead><tbody>${tableRows}</tbody></table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  useEffect(() => {
    api.get<AdvertiserOption[]>('/advertisers?active=true').then(setAdvertiserOptions).catch(() => undefined);
    api.get<AgencyOption[]>('/agencies?active=true').then(setAgencyOptions).catch(() => undefined);
    api.get<SimpleOption[]>('/units?active=true').then(setUnitOptions).catch(() => undefined);
    api.get<SimpleOption[]>('/activity-types?active=true').then(setActivityTypeOptions).catch(() => undefined);
    api.get<PaymentMethodOption[]>('/payment-methods?active=true').then(setPaymentMethodOptions).catch(() => undefined);
  }, []);

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

  useEffect(() => {
    const targetSalesId = canActOnBehalf ? onBehalfOfSalesId : user?.id;
    if (!targetSalesId) {
      setDepartmentOptions([]);
      return;
    }
    const path = canActOnBehalf ? `/departments?salesId=${targetSalesId}&active=true` : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
  }, [canActOnBehalf, onBehalfOfSalesId, user?.id]);

  // Department auto-fills to the Sales's own (first) Department once known - still changeable below.
  useEffect(() => {
    if (departmentOptions.length > 0 && !form.departmentId) {
      setForm((f) => (f.departmentId ? f : { ...f, departmentId: departmentOptions[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentOptions]);

  // Unit auto-fills from the Sales's own profile (or the on-behalf-of Sales's profile).
  useEffect(() => {
    const targetUnitId = canActOnBehalf ? salesOptions.find((s) => s.id === onBehalfOfSalesId)?.unitId : user?.unitId;
    if (targetUnitId && !form.unitId) {
      setForm((f) => (f.unitId ? f : { ...f, unitId: targetUnitId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canActOnBehalf, onBehalfOfSalesId, salesOptions, user?.unitId]);

  useEffect(() => {
    api.get<CategoryOption[]>('/expense-categories?active=true').then(setCategories).catch(() => undefined);
    if (canActOnBehalf) {
      api
        .get<SalesOption[]>('/users')
        .then((users) => setSalesOptions(users.filter((u) => u.roles.includes('SALES'))))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canActOnBehalf]);

  const resetForm = () => {
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
    setInvoiceForm({ merchantName: '', subtotal: '', tax: '', serviceCharge: '', discount: '', total: '' });
    setShowInvoicePreview(false);
    setPreviewFileIndex(0);
  };

  // Auto-OCR every receipt image right after it's picked, so the form pre-fills
  // before the Expense/Invoice even exist (this create form is single-shot -
  // nothing is persisted until final submit). Best-effort: OCR failures never
  // block manual entry (fail-open). An invoice can span more than one image
  // (e.g. a long receipt photographed in two shots) - each new image gets
  // scanned and merged into the existing result:
  //  - merchantName: first one found wins - if image 1 didn't have a readable
  //    name, image 2 (or later) fills it in.
  //  - total: MUST come from that image's own Total/Grand Total line
  //    (ParsedReceipt.total) - never falls back to subtotal. Whichever image's
  //    total is found first is kept; later images don't overwrite it.
  //  - items: concatenated across every scanned image.
  const onInvoiceFilesChange = async (newFiles: File[]) => {
    setInvoiceFiles((prev) => [...prev, ...newFiles]);

    const imagesToScan = newFiles.filter((f) => f.type.startsWith('image/'));
    if (imagesToScan.length === 0) return;

    setOcrScanning(true);
    const warnings: string[] = [];
    let scannedAny = false;
    try {
      for (const file of imagesToScan) {
        try {
          const result = (await uploadFile('/invoices/ocr-scan', file)) as ParsedReceipt;
          scannedAny = true;
          setOcrRaw((prev) => prev ?? result);
          warnings.push(...result.warnings);

          setInvoiceForm((f) => ({
            merchantName: f.merchantName || result.merchantName || '',
            subtotal: f.subtotal || (result.subtotal != null ? String(result.subtotal) : ''),
            tax: f.tax || (result.tax != null ? String(result.tax) : ''),
            serviceCharge: f.serviceCharge || (result.serviceCharge != null ? String(result.serviceCharge) : ''),
            discount: f.discount,
            total: f.total || (result.total != null ? String(result.total) : ''),
          }));

          if (result.items.length > 0) {
            setItems((prev) => [
              ...prev,
              ...result.items.map((it) => ({
                description: it.description,
                price: String(it.unitPrice || it.lineTotal || 0),
                qty: String(it.quantity > 0 ? it.quantity : 1),
                categoryId: '',
              })),
            ]);
          }

          setForm((f) => (!f.amount && result.total != null ? { ...f, amount: String(result.total) } : f));
        } catch (err) {
          warnings.push(err instanceof ApiError ? err.message : `OCR scan failed for ${file.name} - enter invoice details manually.`);
        }
      }
    } finally {
      setOcrWarnings(warnings);
      setOcrScanning(false);
      // Show the scanned data (merchant/items/total, all still editable) right
      // away instead of leaving it behind a manual "Preview Invoice" click.
      if (scannedAny) setShowInvoicePreview(true);
    }
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const updateItem = (index: number, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const addAgency = (agencyId: string) => {
    const a = agencyOptions.find((x) => x.id === agencyId);
    if (a) setSelectedAgencies((prev) => (prev.some((s) => s.id === a.id) ? prev : [...prev, a]));
  };
  const removeAgency = (agencyId: string) => setSelectedAgencies((prev) => prev.filter((a) => a.id !== agencyId));

  const addAdvertiser = (advertiserId: string) => {
    const a = advertiserOptions.find((x) => x.id === advertiserId);
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (invoiceFiles.length > 0 && !invoiceForm.total) {
      setError('Invoice Total is required — open Preview Invoice and fill it in.');
      return;
    }
    if (!primaryAdvertiserId || !primaryBrandId || !form.unitId || !form.activityTypeId) {
      setError('Advertiser, Brand, Unit and Activity Type must all be picked.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const selectedPaymentMethod = paymentMethodOptions.find((m) => m.id === form.paymentMethodId);
      const payload: Record<string, unknown> = {
        ...form,
        amount: Number(form.amount),
        departmentId: form.departmentId || undefined,
        creditCardId: selectedPaymentMethod?.code === 'CORPORATE_CARD' ? form.creditCardId || undefined : undefined,
        paymentMethodId: form.paymentMethodId || undefined,
        paymentMethodNote: form.paymentMethodNote || undefined,
        advertiserId: primaryAdvertiserId,
        brandId: primaryBrandId,
      };
      if (canActOnBehalf && onBehalfOfSalesId) payload.salesId = onBehalfOfSalesId;

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
        if (invoiceForm.merchantName) invoicePayload.finalMerchantName = invoiceForm.merchantName;
        if (invoiceForm.subtotal) invoicePayload.finalSubtotal = Number(invoiceForm.subtotal);
        if (invoiceForm.tax) invoicePayload.finalTax = Number(invoiceForm.tax);
        if (invoiceForm.serviceCharge) invoicePayload.finalServiceCharge = Number(invoiceForm.serviceCharge);
        if (invoiceForm.discount) invoicePayload.finalDiscount = Number(invoiceForm.discount);
        if (invoiceForm.total) invoicePayload.finalTotal = Number(invoiceForm.total);

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

  const noSalesReason = canActOnBehalf && !onBehalfOfSalesId ? 'Pick a Sales to fill in this expense on their behalf.' : null;
  // Advertiser/Brand have no single inherited value anymore (Pre-Event is retired) -
  // the first entry picked in the Advertiser/Brand lists below becomes the primary
  // (mandatory) one, the rest are "additional".
  const primaryAdvertiserId = selectedAdvertisers[0]?.id;
  const primaryBrandId = selectedBrands[0]?.id;
  const selectedPaymentMethodCode = paymentMethodOptions.find((m) => m.id === form.paymentMethodId)?.code;

  return (
    <div>
      <div className="toolbar">
        <h1>Expenses</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search expense no, purpose, sales, advertiser, brand..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 220 }}>
            <option value="">Settled only</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={ALL_STATUSES_VALUE}>All statuses (incl. drafts, default)</option>
          </select>
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
          {canCreate && (
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
          <button type="button" className="btn" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </div>

      {matchMessage && !matching && (
        <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>
          {matchMessage}
        </div>
      )}
      {matchError && !matching && <div className="error-text" style={{ marginBottom: 12 }}>{matchError}</div>}
      {matchedBatches.length > 0 && !matching && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Scanned Data</h3>
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
        </div>
      )}
      {showAutoMatchModal && (
        <Modal title="Auto Match — Upload Bank Settlement PDF" onClose={() => setShowAutoMatchModal(false)}>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
            Upload one or more bank/credit-card settlement PDFs. They&apos;ll be scanned and matched against expenses in the
            background — you can keep working while it runs.
          </p>
          <input
            type="file"
            accept="application/pdf"
            multiple
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
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={autoMatchFiles.length === 0 || matching}
            onClick={() => {
              const files = autoMatchFiles;
              setShowAutoMatchModal(false);
              setAutoMatchFiles([]);
              startAutoMatch(files, forceRescan);
            }}
          >
            {matching ? 'A match is already running...' : 'Upload & Match'}
          </button>
        </Modal>
      )}

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          {canActOnBehalf && (
            <div className="form-row" style={{ maxWidth: 360 }}>
              <label>Sales (manual entry on behalf of)</label>
              <select value={onBehalfOfSalesId} onChange={(e) => setOnBehalfOfSalesId(e.target.value)}>
                <option value="">Select Sales</option>
                {salesOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.employeeId})
                  </option>
                ))}
              </select>
            </div>
          )}

          {noSalesReason ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>{noSalesReason}</div>
          ) : (
            <>
              <div className="form-grid">
                <div className="form-row">
                  <label>Unit</label>
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
                  <label>Activity Type</label>
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
                  <label>Expense Date</label>
                  <DatePicker required value={form.expenseDate} onChange={(v) => setForm({ ...form, expenseDate: v })} />
                </div>
                <div className="form-row">
                  <label>Amount (IDR)</label>
                  <NumberInput required allowDecimals value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
                </div>
                <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                  <label>Purpose</label>
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
                  <label>Department</label>
                  <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">- (optional)</option>
                    {departmentOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>Payment Method</label>
                  <select
                    value={form.paymentMethodId}
                    onChange={(e) => setForm({ ...form, paymentMethodId: e.target.value, creditCardId: '', paymentMethodNote: '' })}
                  >
                    <option value="">- (optional)</option>
                    {paymentMethodOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedPaymentMethodCode === 'CORPORATE_CARD' && (
                  <div className="form-row">
                    <label>Corporate Card</label>
                    <select
                      required
                      disabled={!form.departmentId}
                      value={form.creditCardId}
                      onChange={(e) => setForm({ ...form, creditCardId: e.target.value })}
                    >
                      <option value="">{form.departmentId ? 'Select card' : 'Select a Department first'}</option>
                      {creditCardOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.bank} •••• {c.last4} ({c.cardHolderName})
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
                      {agencyOptions
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
                    Advertiser (bisa lebih dari 1) — pilihan pertama jadi primary
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
                      {advertiserOptions
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
                    Brand (bisa lebih dari 1, berdasarkan Advertiser di atas) — pilihan pertama jadi primary
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
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '4px 16px',
                        maxHeight: 160,
                        overflowY: 'auto',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      {brandOptions.map((b) => (
                        <label key={b.id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
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
                <label style={{ display: 'block', marginBottom: 8 }}>Upload Foto Kegiatan (optional, bisa lebih dari 1)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => setActivityPhotos((prev) => [...prev, ...Array.from(e.target.files || [])])}
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
                  Upload Invoice / Receipt (optional, image/pdf, bisa lebih dari 1) — struk foto (JPEG/PNG/WebP) akan
                  di-scan otomatis pakai OCR
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  onChange={(e) => onInvoiceFilesChange(Array.from(e.target.files || []))}
                />
                {invoiceFiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {invoiceFiles.map((f, i) => (
                      <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setInvoiceFiles((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                )}
                {ocrScanning && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Scanning receipt...</div>}
                {ocrWarnings.map((w, i) => (
                  <div key={i} className="error-text" style={{ fontSize: 12, marginTop: 4 }}>
                    {w}
                  </div>
                ))}

                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" className="btn" onClick={() => setShowInvoicePreview(true)}>
                    <NavIcon name="search" /> Preview Invoice {ocrRaw ? '(from OCR, editable)' : ''}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {invoiceForm.merchantName || '(no merchant name)'} · {items.length} item{items.length === 1 ? '' : 's'} ·
                    Total: {invoiceForm.total ? formatCurrency(invoiceForm.total) : <span className="error-text">required</span>}
                  </span>
                </div>
              </div>
            </>
          )}

          <button
            className="btn btn-primary"
            type="submit"
            disabled={saving || !!noSalesReason || !form.expenseDate}
            style={{ marginTop: 16 }}
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
        </form>
      )}

      {showInvoicePreview && (
        <Modal title="Invoice Preview" onClose={() => setShowInvoicePreview(false)} wide>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 380px', minWidth: 320 }}>
              {invoiceFiles.length > 0 ? (
                <>
                  {invoiceFiles.length > 1 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      {invoiceFiles.map((f, i) => (
                        <button
                          key={`${f.name}-${i}`}
                          type="button"
                          className="btn"
                          style={i === previewFileIndex ? { borderColor: 'var(--primary, #4f7cff)' } : undefined}
                          onClick={() => setPreviewFileIndex(i)}
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <LocalFileZoom file={invoiceFiles[previewFileIndex]} />
                </>
              ) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 6 }}>
                  No invoice file uploaded yet.
                </div>
              )}
            </div>

            <div style={{ flex: '1 1 380px', minWidth: 320 }}>
              <div className="form-row">
                <label style={{ fontSize: 12 }}>Merchant Name</label>
                <input value={invoiceForm.merchantName} onChange={(e) => setInvoiceForm({ ...invoiceForm, merchantName: e.target.value })} />
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <label style={{ margin: 0, fontSize: 12 }}>Items</label>
                  <button type="button" className="btn" onClick={addItem}>
                    + Add Item
                  </button>
                </div>
                {items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <input
                      placeholder="Item name"
                      value={item.description}
                      onChange={(e) => updateItem(i, { description: e.target.value })}
                      style={{ flex: 2 }}
                    />
                    <NumberInput placeholder="Price" value={item.price} onChange={(v) => updateItem(i, { price: v })} style={{ flex: 1 }} />
                    <span style={{ color: 'var(--muted)' }}>×</span>
                    <NumberInput placeholder="Qty" value={item.qty} onChange={(v) => updateItem(i, { qty: v })} style={{ width: 56 }} />
                    <span style={{ flex: 1, fontSize: 13, textAlign: 'right' }}>= {formatCurrency(itemSubtotal(item))}</span>
                    <select value={item.categoryId} onChange={(e) => updateItem(i, { categoryId: e.target.value })} style={{ flex: 1 }}>
                      <option value="">Category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-danger" onClick={() => removeItem(i)}>
                      Remove
                    </button>
                  </div>
                ))}
                {items.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No items - expense amount above is used as-is.</div>}
                {items.length > 0 && (
                  <div style={{ textAlign: 'right', fontSize: 13, marginTop: 4 }}>
                    Subtotal: <strong>{formatCurrency(items.reduce((sum, it) => sum + itemSubtotal(it), 0))}</strong>
                  </div>
                )}
              </div>

              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-row">
                  <label style={{ fontSize: 12 }}>Discount</label>
                  <NumberInput value={invoiceForm.discount} onChange={(v) => setInvoiceForm({ ...invoiceForm, discount: v })} />
                </div>
                <div className="form-row">
                  <label style={{ fontSize: 12 }}>Tax</label>
                  <NumberInput value={invoiceForm.tax} onChange={(v) => setInvoiceForm({ ...invoiceForm, tax: v })} />
                </div>
                <div className="form-row">
                  <label style={{ fontSize: 12 }}>Service Charge</label>
                  <NumberInput value={invoiceForm.serviceCharge} onChange={(v) => setInvoiceForm({ ...invoiceForm, serviceCharge: v })} />
                </div>
                <div className="form-row">
                  <label style={{ fontSize: 12 }}>Total *</label>
                  <NumberInput
                    required
                    value={invoiceForm.total}
                    onChange={(v) => setInvoiceForm({ ...invoiceForm, total: v })}
                  />
                  {!invoiceForm.total && <span className="error-text" style={{ fontSize: 11 }}>Total is required</span>}
                </div>
              </div>

              <button
                type="button"
                className="btn"
                style={{ marginTop: 8 }}
                onClick={() => {
                  const subtotal = items.reduce((sum, it) => sum + itemSubtotal(it), 0);
                  const total = subtotal - (Number(invoiceForm.discount) || 0) + (Number(invoiceForm.tax) || 0) + (Number(invoiceForm.serviceCharge) || 0);
                  setInvoiceForm((f) => ({ ...f, subtotal: String(subtotal), total: String(Math.max(0, total)) }));
                }}
              >
                Auto-calc Subtotal &amp; Total from items
              </button>

              <button
                type="button"
                className="btn btn-primary"
                disabled={!invoiceForm.total}
                style={{ marginTop: 16, display: 'block' }}
                onClick={() => setShowInvoicePreview(false)}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Expense No</th>
              <th>Date</th>
              <th>Sales</th>
              <th>Department</th>
              <th>Advertiser</th>
              <th>Brand</th>
              <th>Purpose</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Matching</th>
              <th>Statement</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((r) => {
              const canEdit = EDITABLE_STATUSES.includes(r.status) && (r.salesId === user?.id || canActOnBehalf);
              const matched = isMatched(r);
              const txn = matchedTransaction(r);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/expenses/${r.id}`}>{r.expenseNo}</Link>
                  </td>
                  <td>{formatDate(r.expenseDate)}</td>
                  <td>{r.sales?.name}</td>
                  <td>{r.department?.name || '-'}</td>
                  <td>{r.advertiser?.name}</td>
                  <td>{r.brand?.name}</td>
                  <td>{r.purpose}</td>
                  <td>{formatCurrency(r.amount)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <span className={`badge ${matched ? 'badge-success' : 'badge-info'}`}>{matched ? 'Matched' : 'Not Matched'}</span>
                  </td>
                  <td>
                    {txn ? (
                      <Link href={`/bank-matching?batchId=${txn.batchId}`} title="Open in Statement / bank matching">
                        {txn.batch.fileName}
                      </Link>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    {canEdit && (
                      <Link href={`/expenses/${r.id}`} className="btn">
                        Edit
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} style={{ color: 'var(--muted)' }}>No expenses</td>
              </tr>
            )}
          </tbody>
        </table>
        {rows.length > 0 && (
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
    </div>
  );
}
