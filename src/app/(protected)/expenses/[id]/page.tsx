'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/date';
import NumberInput from '@/components/NumberInput';
import DatePicker from '@/components/DatePicker';
import FileThumb from '@/components/FileThumb';
import Modal from '@/components/Modal';

interface InvoiceFile {
  id: string;
  fileName: string;
  fileType: string;
  mimeType: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  finalMerchantName: string | null;
  finalTotal: string | null;
  matchingStatus: string;
  files: InvoiceFile[];
}

interface ExpenseItem {
  id: string;
  description: string;
  amount: string;
  categoryId?: string | null;
}

interface ExpenseBrandRow {
  id: string;
  brand: { id: string; name: string };
}

interface ExpenseAgencyRow {
  id: string;
  agency: { id: string; name: string };
}

interface ExpenseAdvertiserRow {
  id: string;
  advertiser: { id: string; name: string };
}

interface ParticipantRow {
  id: string;
  category: string;
  name: string;
  position: string | null;
  company: string | null;
}

interface CreditCardOption {
  id: string;
  bank: string;
  last4: string;
  cardHolderName: string;
}

type ParticipantCategory = 'AGENCY' | 'ADVERTISER' | 'EMPLOYEE';

interface ParticipantEditRow {
  category: ParticipantCategory;
  name: string;
  position: string;
  company: string;
}

const PARTICIPANT_SECTIONS: { category: ParticipantCategory; label: string }[] = [
  { category: 'AGENCY', label: 'Agency' },
  { category: 'ADVERTISER', label: 'Advertiser' },
  { category: 'EMPLOYEE', label: 'Employee' },
];

const emptyParticipant = (category: ParticipantCategory): ParticipantEditRow => ({ category, name: '', position: '', company: '' });

const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'CREDIT_CARD', label: 'Credit Card' },
  { value: 'GOPAY', label: 'GoPay' },
  { value: 'SHOPEEPAY', label: 'ShopeePay' },
  { value: 'DANA', label: 'Dana' },
  { value: 'OVO', label: 'OVO' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHER', label: 'Others' },
];

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
  costCenterId: string | null;
  sales: { name: string };
  unit: { name: string };
  advertiser: { id: string; name: string };
  brand: { id: string; name: string };
  activityType: { name: string };
  creditCard: { bank: string; last4: string; cardHolderName: string } | null;
  creditCardId: string | null;
  paymentMethodType: string | null;
  paymentMethodNote: string | null;
  merchantName: string | null;
  location: string | null;
  department: { id: string; name: string } | null;
  items: ExpenseItem[];
  invoices: Invoice[];
  extraBrands: ExpenseBrandRow[];
  extraAgencies: ExpenseAgencyRow[];
  extraAdvertisers: ExpenseAdvertiserRow[];
  participants: ParticipantRow[];
  photos: PhotoRow[];
  bankTransactions: { id: string; status: string }[];
  isMatched: boolean;
  settlement: { id: string; settlementNo: string } | null;
}

interface TransactionSearchResult {
  id: string;
  rawDescription: string;
  amount: string;
  transactionDate: string | null;
  cardLast4: string | null;
  status: string;
  batch: { id: string; fileName: string };
}

const MATCHED_TXN_STATUSES = ['AUTO_MATCHED', 'MANUAL_MATCHED'];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CREDIT_CARD: 'Credit Card',
  GOPAY: 'GoPay',
  SHOPEEPAY: 'ShopeePay',
  DANA: 'Dana',
  OVO: 'OVO',
  BANK_TRANSFER: 'Bank Transfer',
  CASH: 'Cash',
  OTHER: 'Others',
};

interface ApprovalAction {
  id: string;
  action: string;
  reason: string | null;
  actedAt: string;
  actor: { name: string };
  position: { name: string };
}

interface ApprovalStep {
  stepOrder: number;
  status: string;
  position: { name: string };
  resolvedApprover: { id: string; name: string };
}

interface ApprovalDetail {
  steps: ApprovalStep[];
  currentStep: number;
  status: string;
  actions: ApprovalAction[];
}

interface Option {
  id: string;
  name: string;
}

interface EditItemRow {
  description: string;
  amount: string;
  categoryId: string;
}

// Per product decision, an expense may be edited at any status except these
// three terminal/locked ones (APPROVED, REJECTED, SETTLED) - everything else,
// including in-flight OCR/matching/approval statuses, remains editable.
const LOCKED_STATUSES = ['APPROVED', 'REJECTED', 'SETTLED'];


function formatCurrency(value: string | number | null) {
  if (value === null) return '-';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasRole, hasPermission } = useAuth();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: '', finalMerchantName: '', finalTotal: '' });

  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [editingFields, setEditingFields] = useState(false);
  const [editForm, setEditForm] = useState({
    purpose: '',
    amount: '',
    costCenterId: '',
    expenseDate: '',
    merchantName: '',
    location: '',
    paymentMethodType: '',
    paymentMethodNote: '',
    creditCardId: '',
  });
  const [editItems, setEditItems] = useState<EditItemRow[]>([]);
  const [editLocating, setEditLocating] = useState(false);

  const [agencyOptions, setAgencyOptions] = useState<Option[]>([]);
  const [advertiserOptions, setAdvertiserOptions] = useState<Option[]>([]);
  const [brandOptions, setBrandOptions] = useState<Option[]>([]);
  const [creditCardOptions, setCreditCardOptions] = useState<CreditCardOption[]>([]);
  const [editExtraAgencies, setEditExtraAgencies] = useState<Option[]>([]);
  const [editExtraAdvertisers, setEditExtraAdvertisers] = useState<Option[]>([]);
  const [editExtraBrands, setEditExtraBrands] = useState<Option[]>([]);
  const [editParticipants, setEditParticipants] = useState<ParticipantEditRow[]>([]);

  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [matchSearch, setMatchSearch] = useState('');
  const [matchResults, setMatchResults] = useState<TransactionSearchResult[]>([]);
  const [matching, setMatching] = useState(false);

  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceTotalDraft, setInvoiceTotalDraft] = useState('');

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

  useEffect(() => {
    api.get<Option[]>('/cost-centers').then(setCostCenters).catch(() => undefined);
    api.get<Option[]>('/expense-categories').then(setCategories).catch(() => undefined);
    api.get<Option[]>('/advertisers').then(setAdvertiserOptions).catch(() => undefined);
    api.get<Option[]>('/agencies').then(setAgencyOptions).catch(() => undefined);
  }, []);

  // Brand options narrow to the expense's own (locked) primary Advertiser plus
  // whichever extra Advertisers are currently picked below, so Brand always
  // matches an Advertiser actually associated with this expense.
  const extraAdvertiserIds = editExtraAdvertisers.map((a) => a.id).join(',');
  useEffect(() => {
    if (!expense) {
      setBrandOptions([]);
      return;
    }
    const ids = [expense.advertiser.id, ...editExtraAdvertisers.map((a) => a.id)].join(',');
    api
      .get<Option[]>(`/brands?advertiserIds=${ids}`)
      .then(setBrandOptions)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense?.advertiser.id, extraAdvertiserIds]);

  // 1 Department = 1 credit card - scope the Credit Card dropdown to this expense's own Department.
  useEffect(() => {
    if (!expense?.department?.id) {
      setCreditCardOptions([]);
      return;
    }
    api.get<CreditCardOption[]>(`/credit-cards?departmentId=${expense.department.id}`).then(setCreditCardOptions).catch(() => undefined);
  }, [expense?.department?.id]);

  const isOwner = expense?.salesId === user?.id;
  const isOwnerOrBackOffice = isOwner || hasRole('ADMIN', 'FINANCE');
  // expense.edit.owndept is shown optimistically, same caveat as expense.approve.owndept
  // below - the backend's canEditExpense() is authoritative and 403s if the expense's
  // Department isn't actually the actor's.
  const canEditFields =
    !!expense &&
    (isOwnerOrBackOffice || hasPermission('expense.edit.all', 'expense.edit.owndept')) &&
    !LOCKED_STATUSES.includes(expense.status);
  const currentStepInfo = approval && approval.status === 'PENDING' ? approval.steps.find((s) => s.stepOrder === approval.currentStep) : null;
  // Only the step's actual resolvedApprover (or an ADMIN override) sees the
  // Approve/Reject buttons here - deliberately not surfaced for an
  // expense.approve.all/owndept holder too (same call as the Pending Approval
  // list), so after they approve their own step the button doesn't linger for
  // the next approver's step. That permission still works via the backend's
  // assertApprovalOverride if someone needs to act on someone else's step.
  const canAct = !!currentStepInfo && (currentStepInfo.resolvedApprover?.id === user?.id || hasRole('ADMIN'));
  const canMatch = hasRole('ADMIN', 'FINANCE') || hasPermission('expense.match.all', 'expense.match.ownpod');
  const matchedTxn = expense?.bankTransactions.find((t) => MATCHED_TXN_STATUSES.includes(t.status)) ?? null;

  const startEditFields = () => {
    if (!expense) return;
    setEditForm({
      purpose: expense.purpose,
      amount: expense.amount,
      costCenterId: expense.costCenterId ?? '',
      expenseDate: expense.expenseDate.slice(0, 10),
      merchantName: expense.merchantName ?? '',
      location: expense.location ?? '',
      paymentMethodType: expense.paymentMethodType ?? '',
      paymentMethodNote: expense.paymentMethodNote ?? '',
      creditCardId: expense.creditCardId ?? '',
    });
    setEditItems(expense.items.map((it) => ({ description: it.description, amount: it.amount, categoryId: it.categoryId ?? '' })));
    setEditExtraAgencies(expense.extraAgencies.map((ea) => ea.agency));
    setEditExtraAdvertisers(expense.extraAdvertisers.map((ea) => ea.advertiser));
    setEditExtraBrands(expense.extraBrands.map((eb) => eb.brand));
    setEditParticipants(
      expense.participants.map((p) => ({
        category: p.category as ParticipantCategory,
        name: p.name,
        position: p.position ?? '',
        company: p.company ?? '',
      })),
    );
    setEditingFields(true);
  };

  const addEditItem = () => setEditItems((prev) => [...prev, { description: '', amount: '', categoryId: '' }]);
  const updateEditItem = (i: number, patch: Partial<EditItemRow>) =>
    setEditItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const removeEditItem = (i: number) => setEditItems((prev) => prev.filter((_, idx) => idx !== i));

  const addExtraAgency = (agencyId: string) => {
    const a = agencyOptions.find((x) => x.id === agencyId);
    if (a) setEditExtraAgencies((prev) => (prev.some((s) => s.id === a.id) ? prev : [...prev, a]));
  };
  const removeExtraAgency = (agencyId: string) => setEditExtraAgencies((prev) => prev.filter((a) => a.id !== agencyId));

  const addExtraAdvertiser = (advertiserId: string) => {
    const a = advertiserOptions.find((x) => x.id === advertiserId);
    if (a) setEditExtraAdvertisers((prev) => (prev.some((s) => s.id === a.id) ? prev : [...prev, a]));
  };
  const removeExtraAdvertiser = (advertiserId: string) => setEditExtraAdvertisers((prev) => prev.filter((a) => a.id !== advertiserId));

  const toggleExtraBrand = (brand: Option) =>
    setEditExtraBrands((prev) => (prev.some((b) => b.id === brand.id) ? prev.filter((b) => b.id !== brand.id) : [...prev, brand]));

  const addEditParticipant = (category: ParticipantCategory) => setEditParticipants((prev) => [...prev, emptyParticipant(category)]);
  const updateEditParticipant = (i: number, patch: Partial<ParticipantEditRow>) =>
    setEditParticipants((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removeEditParticipant = (i: number) => setEditParticipants((prev) => prev.filter((_, idx) => idx !== i));

  const saveFields = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const validItems = editItems
        .filter((it) => it.description.trim() && it.amount)
        .map((it) => ({ description: it.description, amount: Number(it.amount), categoryId: it.categoryId || undefined }));

      const payload: Record<string, unknown> = {
        purpose: editForm.purpose,
        amount: Number(editForm.amount),
        expenseDate: editForm.expenseDate || undefined,
        costCenterId: editForm.costCenterId || undefined,
        merchantName: editForm.merchantName || undefined,
        location: editForm.location || undefined,
        paymentMethodType: editForm.paymentMethodType || undefined,
        paymentMethodNote: editForm.paymentMethodNote || undefined,
        creditCardId: editForm.paymentMethodType === 'CREDIT_CARD' ? editForm.creditCardId || undefined : undefined,
      };
      if (validItems.length > 0) payload.items = validItems;
      if (editExtraAgencies.length > 0) payload.extraAgencyIds = editExtraAgencies.map((a) => a.id);
      if (editExtraAdvertisers.length > 0) payload.extraAdvertiserIds = editExtraAdvertisers.map((a) => a.id);
      if (editExtraBrands.length > 0) payload.extraBrandIds = editExtraBrands.map((b) => b.id);

      const validParticipants = editParticipants
        .filter((p) => p.name.trim())
        .map((p) => ({ category: p.category, name: p.name, position: p.position || undefined, company: p.company || undefined }));
      if (validParticipants.length > 0) payload.participants = validParticipants;

      await api.patch(`/expenses/${id}`, payload);
      setEditingFields(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/approvals/expense/${id}/approve`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    const reason = window.prompt('Reject reason:');
    if (!reason) return;
    setBusy(true);
    try {
      await api.post(`/approvals/expense/${id}/reject`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  const markUnmatched = async (transactionId: string) => {
    setMatching(true);
    setError('');
    try {
      await api.post(`/bank-settlements/transactions/${transactionId}/unmatch`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unmatch failed');
    } finally {
      setMatching(false);
    }
  };

  const searchTransactions = async (term: string) => {
    try {
      const results = await api.get<TransactionSearchResult[]>(
        `/bank-settlements/transactions/search?search=${encodeURIComponent(term)}`,
      );
      setMatchResults(results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed');
    }
  };

  // "Manual, no billing statement" match/unmatch - for spend that never shows up
  // on a bank/credit-card statement line at all (e-wallet, personal cash pending
  // reimbursement), so there's no transaction to link to.
  const markManualMatched = async () => {
    setMatching(true);
    setError('');
    try {
      await api.post(`/bank-settlements/expenses/${id}/manual-match`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Match failed');
    } finally {
      setMatching(false);
    }
  };

  const markManualUnmatched = async () => {
    setMatching(true);
    setError('');
    try {
      await api.post(`/bank-settlements/expenses/${id}/manual-unmatch`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unmatch failed');
    } finally {
      setMatching(false);
    }
  };

  const markMatched = async (transactionId: string) => {
    setMatching(true);
    setError('');
    try {
      await api.post(`/bank-settlements/transactions/${transactionId}/match`, { expenseId: id });
      setShowMatchPicker(false);
      setMatchResults([]);
      setMatchSearch('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Match failed');
    } finally {
      setMatching(false);
    }
  };

  const addInvoice = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/expenses/${id}/invoices`, {
        ...invoiceForm,
        finalTotal: invoiceForm.finalTotal ? Number(invoiceForm.finalTotal) : undefined,
      });
      setInvoiceForm({ invoiceNumber: '', finalMerchantName: '', finalTotal: '' });
      setShowInvoiceForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add invoice failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadInvoiceFile = async (invoiceId: string, file: File) => {
    setBusy(true);
    try {
      await uploadFile(`/invoices/${invoiceId}/files`, file);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const saveInvoiceTotal = async (invoiceId: string) => {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/invoices/${invoiceId}`, { finalTotal: Number(invoiceTotalDraft) });
      setEditingInvoiceId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update total failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadActivityPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(`/expenses/${id}/photos`, file);
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !expense) return <div className="error-text">{error}</div>;
  if (!expense) return <div>Loading...</div>;

  return (
    <div>
      <div className="toolbar">
        <h1>{expense.expenseNo}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="badge badge-info">{expense.status}</span>
          <span className={`badge ${expense.isMatched ? 'badge-success' : 'badge-info'}`}>{expense.isMatched ? 'Matched' : 'Not Matched'}</span>
          {expense.settlement && <span className="badge badge-info">{expense.settlement.settlementNo}</span>}
          {canEditFields && (
            <button className="btn" onClick={() => (editingFields ? setEditingFields(false) : startEditFields())}>
              {editingFields ? 'Cancel Edit' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}

      {editingFields ? (
        <form className="card" onSubmit={saveFields}>
          <h3 style={{ marginTop: 0 }}>Edit Expense</h3>
          <div className="form-grid">
            <div className="form-row">
              <label>Expense Date</label>
              <DatePicker required value={editForm.expenseDate} onChange={(v) => setEditForm({ ...editForm, expenseDate: v })} />
            </div>
            <div className="form-row">
              <label>Amount (IDR)</label>
              <NumberInput required allowDecimals value={editForm.amount} onChange={(v) => setEditForm({ ...editForm, amount: v })} />
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Purpose</label>
              <input required value={editForm.purpose} onChange={(e) => setEditForm({ ...editForm, purpose: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Merchant</label>
              <input
                value={editForm.merchantName}
                onChange={(e) => setEditForm({ ...editForm, merchantName: e.target.value })}
                placeholder="e.g. restaurant/venue name"
              />
            </div>
            <div className="form-row">
              <label>Location</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  value={editForm.location}
                  onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  placeholder="Address or coordinates"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={editLocating}
                  title="Use my current location"
                  onClick={() => {
                    if (!navigator.geolocation) {
                      setError('Geolocation is not supported by this browser.');
                      return;
                    }
                    setEditLocating(true);
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        setEditForm((f) => ({ ...f, location: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` }));
                        setEditLocating(false);
                      },
                      () => {
                        setError('Could not get your location - check browser permission.');
                        setEditLocating(false);
                      },
                    );
                  }}
                >
                  {editLocating ? '...' : '📍'}
                </button>
              </div>
            </div>
            <div className="form-row">
              <label>Cost Center (optional)</label>
              <select value={editForm.costCenterId} onChange={(e) => setEditForm({ ...editForm, costCenterId: e.target.value })}>
                <option value="">-</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Payment Method</label>
              <select
                value={editForm.paymentMethodType}
                onChange={(e) => setEditForm({ ...editForm, paymentMethodType: e.target.value, creditCardId: '', paymentMethodNote: '' })}
              >
                <option value="">- (optional)</option>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {editForm.paymentMethodType === 'CREDIT_CARD' && (
              <div className="form-row">
                <label>Credit Card</label>
                <select
                  required
                  disabled={!expense.department}
                  value={editForm.creditCardId}
                  onChange={(e) => setEditForm({ ...editForm, creditCardId: e.target.value })}
                >
                  <option value="">{expense.department ? 'Select card' : 'This expense has no Department'}</option>
                  {creditCardOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.bank} •••• {c.last4} ({c.cardHolderName})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {['GOPAY', 'SHOPEEPAY', 'DANA', 'OVO'].includes(editForm.paymentMethodType) && (
              <div className="form-row">
                <label style={{ fontSize: 12 }}>Account / Phone Number (optional)</label>
                <input value={editForm.paymentMethodNote} onChange={(e) => setEditForm({ ...editForm, paymentMethodNote: e.target.value })} />
              </div>
            )}
            {editForm.paymentMethodType === 'OTHER' && (
              <div className="form-row">
                <label style={{ fontSize: 12 }}>Please specify</label>
                <input required value={editForm.paymentMethodNote} onChange={(e) => setEditForm({ ...editForm, paymentMethodNote: e.target.value })} />
              </div>
            )}
          </div>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>Additional Agencies (bisa lebih dari 1)</label>
              {editExtraAgencies.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {editExtraAgencies.map((a) => (
                    <span key={a.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {a.name}
                      <button
                        type="button"
                        onClick={() => removeExtraAgency(a.id)}
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
                <select value="" onChange={(e) => e.target.value && addExtraAgency(e.target.value)}>
                  <option value="">+ Add an agency</option>
                  {agencyOptions
                    .filter((a) => !editExtraAgencies.some((s) => s.id === a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>Additional Advertisers (beyond the primary, bisa lebih dari 1)</label>
              {editExtraAdvertisers.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {editExtraAdvertisers.map((a) => (
                    <span key={a.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {a.name}
                      <button
                        type="button"
                        onClick={() => removeExtraAdvertiser(a.id)}
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
                <select value="" onChange={(e) => e.target.value && addExtraAdvertiser(e.target.value)}>
                  <option value="">+ Add an advertiser</option>
                  {advertiserOptions
                    .filter((a) => a.id !== expense.advertiser.id && !editExtraAdvertisers.some((s) => s.id === a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>Additional Brands (beyond the primary Brand {expense.brand.name})</label>
              {editExtraBrands.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {editExtraBrands.map((b) => (
                    <span key={b.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {b.name}
                      <button
                        type="button"
                        onClick={() => toggleExtraBrand(b)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit' }}
                        aria-label={`Remove ${b.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
                {brandOptions
                  .filter((b) => b.id !== expense.brand.id)
                  .map((b) => (
                    <label key={b.id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={editExtraBrands.some((sb) => sb.id === b.id)} onChange={() => toggleExtraBrand(b)} />
                      {b.name}
                    </label>
                  ))}
                {brandOptions.filter((b) => b.id !== expense.brand.id).length === 0 && (
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>No other brands under the selected advertiser(s)</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', marginBottom: 8 }}>Participants (optional)</label>
            {PARTICIPANT_SECTIONS.map((section) => (
              <div key={section.category} style={{ marginBottom: 12 }}>
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <label style={{ margin: 0, fontSize: 13 }}>{section.label}</label>
                  <button type="button" className="btn" onClick={() => addEditParticipant(section.category)}>
                    + Add {section.label}
                  </button>
                </div>
                {editParticipants.map((p, i) =>
                  p.category === section.category ? (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <input
                        placeholder="Name"
                        value={p.name}
                        onChange={(e) => updateEditParticipant(i, { name: e.target.value })}
                        style={{ flex: 2 }}
                      />
                      <input
                        placeholder="Jabatan / Position"
                        value={p.position}
                        onChange={(e) => updateEditParticipant(i, { position: e.target.value })}
                        style={{ flex: 1 }}
                      />
                      <input
                        placeholder="Company (optional)"
                        value={p.company}
                        onChange={(e) => updateEditParticipant(i, { company: e.target.value })}
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="btn btn-danger" onClick={() => removeEditParticipant(i)}>
                        Remove
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <label style={{ margin: 0 }}>Line Items</label>
              <button type="button" className="btn" onClick={addEditItem}>
                + Add Item
              </button>
            </div>
            {editItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input
                  placeholder="Description"
                  value={item.description}
                  onChange={(e) => updateEditItem(i, { description: e.target.value })}
                  style={{ flex: 2 }}
                />
                <NumberInput placeholder="Amount" value={item.amount} onChange={(v) => updateEditItem(i, { amount: v })} style={{ flex: 1 }} />
                <select value={item.categoryId} onChange={(e) => updateEditItem(i, { categoryId: e.target.value })} style={{ flex: 1 }}>
                  <option value="">Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-danger" onClick={() => removeEditItem(i)}>
                  Remove
                </button>
              </div>
            ))}
            {editItems.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No line items - amount above is used as-is.</div>}
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy || !editForm.expenseDate} style={{ marginTop: 16 }}>
            {busy ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      ) : (
        <div className="card">
          <div className="form-grid">
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Sales</div>
              <div>{expense.sales?.name}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Unit</div>
              <div>{expense.unit?.name}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Advertiser</div>
              <div>{expense.advertiser?.name}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Brand</div>
              <div>{expense.brand?.name}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Activity</div>
              <div>{expense.activityType?.name}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Date</div>
              <div>{formatDate(expense.expenseDate)}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Amount</div>
              <div>{formatCurrency(expense.amount)}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Purpose</div>
              <div>{expense.purpose}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Department</div>
              <div>{expense.department?.name || '-'}</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Payment Method</div>
              <div>
                {expense.paymentMethodType ? PAYMENT_METHOD_LABELS[expense.paymentMethodType] ?? expense.paymentMethodType : '-'}
                {expense.creditCard ? ` (${expense.creditCard.bank} •••• ${expense.creditCard.last4})` : ''}
                {expense.paymentMethodNote ? ` — ${expense.paymentMethodNote}` : ''}
              </div>
            </div>
            {expense.extraBrands.length > 0 && (
              <div>
                <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Additional Brands</div>
                <div>{expense.extraBrands.map((eb) => eb.brand.name).join(', ')}</div>
              </div>
            )}
          </div>

          {expense.participants.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>Participants</div>
              {expense.participants.map((p) => (
                <div key={p.id} style={{ fontSize: 13, padding: '2px 0' }}>
                  [{p.category}] {p.name}
                  {p.position ? ` — ${p.position}` : ''}
                  {p.company ? ` (${p.company})` : ''}
                </div>
              ))}
            </div>
          )}

          {expense.items.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="label" style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>Line Items</div>
              {expense.items.map((it) => (
                <div key={it.id} style={{ fontSize: 13, padding: '2px 0' }}>
                  {it.description} — {formatCurrency(it.amount)}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            {canAct && (
              <>
                <button className="btn btn-success" disabled={busy} onClick={approve}>
                  Approve ({currentStepInfo?.position.name})
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={reject}>
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>Invoices</h3>
          {canEditFields && (
            <button className="btn" onClick={() => setShowInvoiceForm((v) => !v)}>
              {showInvoiceForm ? 'Cancel' : '+ Add Invoice'}
            </button>
          )}
        </div>

        {showInvoiceForm && (
          <form onSubmit={addInvoice} style={{ marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
            <div className="form-grid">
              <div className="form-row">
                <label>Invoice Number</label>
                <input value={invoiceForm.invoiceNumber} onChange={(e) => setInvoiceForm({ ...invoiceForm, invoiceNumber: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Merchant Name</label>
                <input value={invoiceForm.finalMerchantName} onChange={(e) => setInvoiceForm({ ...invoiceForm, finalMerchantName: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Total Amount</label>
                <NumberInput value={invoiceForm.finalTotal} onChange={(v) => setInvoiceForm({ ...invoiceForm, finalTotal: v })} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
              Save Invoice
            </button>
          </form>
        )}

        {expense.invoices.map((inv) => (
          <div key={inv.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>{inv.finalMerchantName || 'Unnamed merchant'}</strong> — {inv.invoiceNumber || 'no number'}
              </div>
              {editingInvoiceId === inv.id ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <NumberInput value={invoiceTotalDraft} onChange={setInvoiceTotalDraft} style={{ width: 140 }} />
                  <button className="btn btn-primary" disabled={busy} onClick={() => saveInvoiceTotal(inv.id)}>
                    Save
                  </button>
                  <button className="btn" disabled={busy} onClick={() => setEditingInvoiceId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {formatCurrency(inv.finalTotal)}
                  {canEditFields && (
                    <button
                      className="btn"
                      onClick={() => {
                        setEditingInvoiceId(inv.id);
                        setInvoiceTotalDraft(inv.finalTotal ?? '');
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Matching: {inv.matchingStatus}</div>
            {inv.files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {inv.files.map((f) => (
                  <FileThumb key={f.id} path={`/invoices/files/${f.id}/download`} fileName={f.fileName} isImage={f.mimeType.startsWith('image/')} />
                ))}
              </div>
            )}
            {canEditFields && (
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                style={{ marginTop: 8 }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadInvoiceFile(inv.id, file);
                }}
              />
            )}
          </div>
        ))}
        {expense.invoices.length === 0 && <div style={{ color: 'var(--muted)' }}>No invoices attached</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Foto Kegiatan</h3>
        {canEditFields && (
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(e) => uploadActivityPhotos(e.target.files)}
          />
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {expense.photos.map((p) => (
            <FileThumb key={p.id} path={`/expenses/photos/${p.id}/download`} fileName={p.fileName} isImage={p.mimeType.startsWith('image/')} />
          ))}
          {expense.photos.length === 0 && <div style={{ color: 'var(--muted)' }}>No photos uploaded</div>}
        </div>
      </div>

      {approval && (
        <div className="card">
          <h3>Approval Trail</h3>
          <div style={{ marginBottom: 8 }}>
            Status: <span className="badge">{approval.status}</span> · Chain:{' '}
            {[...approval.steps]
              .sort((a, b) => a.stepOrder - b.stepOrder)
              .map((s) => `${s.position.name} (${s.resolvedApprover?.name})`)
              .join(' → ')}
          </div>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Position</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {approval.actions.map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.actedAt)}</td>
                  <td>{a.position?.name}</td>
                  <td>{a.action}</td>
                  <td>{a.actor?.name}</td>
                  <td>{a.reason || '-'}</td>
                </tr>
              ))}
              {approval.actions.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--muted)' }}>No actions yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {canMatch && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Bank Matching</h3>
          {matchedTxn ? (
            <>
              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
                Linked to a billing statement transaction.
              </div>
              <button className="btn btn-danger" disabled={matching} onClick={() => markUnmatched(matchedTxn.id)}>
                Unmatched
              </button>
            </>
          ) : expense.isMatched ? (
            <>
              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
                Manually matched - no billing statement transaction (e.g. e-wallet / personal reimbursement to be settled directly).
              </div>
              <button className="btn btn-danger" disabled={matching} onClick={markManualUnmatched}>
                Unmatched
              </button>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
                Link this expense to a bank/credit-card statement line, or mark it matched directly if it won&apos;t appear on any statement
                (e-wallet, personal cash pending reimbursement).
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-success"
                  disabled={matching}
                  onClick={() => {
                    setShowMatchPicker(true);
                    setMatchResults([]);
                    setMatchSearch('');
                  }}
                >
                  Matched (link to statement)
                </button>
                <button className="btn" disabled={matching} onClick={markManualMatched}>
                  Matched (no statement)
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {showMatchPicker && (
        <Modal title="Mark as Matched" onClose={() => setShowMatchPicker(false)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              autoFocus
              placeholder="Search transaction description..."
              value={matchSearch}
              onChange={(e) => setMatchSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchTransactions(matchSearch)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={() => searchTransactions(matchSearch)}>
              Search
            </button>
          </div>
          {matchResults.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No results yet - search for a statement line above.</div>}
          {matchResults.map((t) => (
            <div
              key={t.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}
            >
              <div>
                <div>{t.rawDescription}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t.batch.fileName} · {formatDate(t.transactionDate)} ·{' '}
                  {formatCurrency(t.amount)} · <span className="badge badge-info">{t.status}</span>
                </div>
              </div>
              <button className="btn btn-primary" disabled={matching} onClick={() => markMatched(t.id)}>
                Link
              </button>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
