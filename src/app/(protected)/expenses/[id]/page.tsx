'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/date';
import NumberInput from '@/components/NumberInput';
import DatePicker from '@/components/DatePicker';
import FileThumb from '@/components/FileThumb';
import FileOrCameraInput from '@/components/FileOrCameraInput';
import LocalFileThumb from '@/components/LocalFileThumb';
import Modal from '@/components/Modal';
import { useAlert } from '@/components/ConfirmDialog';
import { usePrompt } from '@/components/PromptDialog';
import SplashLoader from '@/components/SplashLoader';
import { isExpenseEditable } from '@/lib/expenseEdit';
import { MATCH_FIRST_MESSAGE, mustMatchBeforeApprove } from '@/lib/expenseApproval';

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
  user: { id: string; name: string } | null;
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

interface PaymentMethodOption {
  id: string;
  code: string;
  name: string;
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
  costCenterId: string | null;
  sales: { name: string };
  unit: { name: string };
  advertiser: { id: string; name: string } | null; // null: raised from an Agency-only Expense Request
  brand: { id: string; name: string } | null;
  activityType: { name: string };
  creditCard: { bank: string; last4: string; user: { id: string; name: string } | null } | null;
  creditCardId: string | null;
  paymentMethodId: string | null;
  paymentMethod: { id: string; code: string; name: string } | null;
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
  settlement: {
    id: string;
    settlementNo: string;
    odooSyncStatus: string;
    odooSyncError: string | null;
  } | null;
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
  position: { code: string; name: string };
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

// Editable only in the statuses of lib/expenseEdit.ts - once the requestor submits it, it is read-only until READY_TO_MATCHING.


function formatCurrency(value: string | number | null) {
  if (value === null) return '-';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // ?mode=edit opens the Edit form straight away, ?mode=view hides every edit control (the Request list's "Open Expense").
  const pageMode = useSearchParams().get('mode');
  const readOnlyMode = pageMode === 'view';
  const { user, hasRole, hasPermission } = useAuth();
  const prompt = usePrompt();
  const alert = useAlert();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  // "+ Add Invoice" is upload-only: the file(s) are picked/captured here and uploaded
  // together with the new Invoice on Save (no number/merchant/total entry).
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [scanningInvoice, setScanningInvoice] = useState(false);
  const [invoiceScanNote, setInvoiceScanNote] = useState('');
  const [showPhotoForm, setShowPhotoForm] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

  const [categories, setCategories] = useState<Option[]>([]);
  const [editingFields, setEditingFields] = useState(false);
  const [editForm, setEditForm] = useState({
    purpose: '',
    amount: '',
    expenseDate: '',
    merchantName: '',
    location: '',
    paymentMethodId: '',
    paymentMethodNote: '',
    creditCardId: '',
  });
  const [editItems, setEditItems] = useState<EditItemRow[]>([]);
  const [editLocating, setEditLocating] = useState(false);

  const [agencyOptions, setAgencyOptions] = useState<Option[]>([]);
  const [advertiserOptions, setAdvertiserOptions] = useState<Option[]>([]);
  const [brandOptions, setBrandOptions] = useState<Option[]>([]);
  const [creditCardOptions, setCreditCardOptions] = useState<CreditCardOption[]>([]);
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<PaymentMethodOption[]>([]);
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
    api.get<Option[]>('/expense-categories?active=true').then(setCategories).catch(() => undefined);
    api.get<Option[]>('/advertisers?active=true').then(setAdvertiserOptions).catch(() => undefined);
    api.get<Option[]>('/agencies?active=true').then(setAgencyOptions).catch(() => undefined);
    api.get<PaymentMethodOption[]>('/payment-methods?active=true').then(setPaymentMethodOptions).catch(() => undefined);
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
    const ids = [expense.advertiser?.id, ...editExtraAdvertisers.map((a) => a.id)].filter(Boolean).join(',');
    if (!ids) {
      setBrandOptions([]);
      return;
    }
    api
      .get<Option[]>(`/brands?advertiserIds=${ids}&active=true`)
      .then(setBrandOptions)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense?.advertiser?.id, extraAdvertiserIds]);

  // 1 Department = 1 credit card - scope the Corporate Card dropdown to this expense's own Department.
  useEffect(() => {
    if (!expense?.department?.id) {
      setCreditCardOptions([]);
      return;
    }
    api.get<CreditCardOption[]>(`/credit-cards?departmentId=${expense.department.id}&active=true`).then(setCreditCardOptions).catch(() => undefined);
  }, [expense?.department?.id]);

  const isOwner = expense?.salesId === user?.id;
  const isOwnerOrBackOffice = isOwner || hasRole('ADMINISTRATOR');
  // expense.edit.owndept is shown optimistically, same caveat as expense.approve.owndept
  // below - the backend's canEditExpense() is authoritative and 403s if the expense's
  // Department isn't actually the actor's.
  // A PENDING_SALES_ADMIN expense (raised by Corsec) is completed by any Sales Admin of its
  // Department - the backend (canCompletePendingSalesAdmin) 403s one from another Department.
  const completesPendingSalesAdmin = expense?.status === 'PENDING_SALES_ADMIN' && hasRole('SALES_ADMIN');
  const canEditFields =
    !!expense &&
    (isOwnerOrBackOffice || completesPendingSalesAdmin || hasPermission('expense.edit.all', 'expense.edit.owndept')) &&
    isExpenseEditable(expense.status) &&
    !readOnlyMode;
  // A Request-linked expense (Flower Bouquet) still waiting on its Sales Admin has no
  // approval chain yet, but its Level starts at the Sales Admin tier itself - so the
  // Sales Admin acts on it directly (Approve / Revise / Reject) rather than "submitting"
  // it and then approving their own step. The backend enters the chain on that action.
  const salesAdminActsDirectly =
    !!expense &&
    expense.status === 'PENDING_SALES_ADMIN' &&
    !!expense.expenseRequestId &&
    (hasRole('SALES_ADMIN') || hasRole('ADMINISTRATOR'));
  // Photos/invoices are attached via an edit: no expense.edit.* permission (own -
  // owner only, all/owndept - broader) means no upload controls, even for the owner.
  // ADMIN is exempt. The backend enforces the same rule.
  const canUploadFiles =
    !!expense &&
    (hasRole('ADMINISTRATOR') ||
      completesPendingSalesAdmin ||
      hasPermission('expense.edit.all', 'expense.edit.owndept') ||
      (isOwner && hasPermission('expense.edit.own'))) &&
    isExpenseEditable(expense.status) &&
    !readOnlyMode;
  const currentStepInfo = approval && approval.status === 'PENDING' ? approval.steps.find((s) => s.stepOrder === approval.currentStep) : null;
  // Only the step's actual resolvedApprover (or an ADMIN override) sees the
  // Approve/Revise buttons here - deliberately not surfaced for an
  // expense.approve.all/owndept holder too (same call as the Pending Approval
  // list), so after they approve their own step the button doesn't linger for
  // the next approver's step. That permission still works via the backend's
  // assertApprovalOverride if someone needs to act on someone else's step.
  // The Sales Admin tier (Position SLSADM) belongs to every Sales Admin of the Department,
  // not just the one the Department mapping resolved - the backend (isSalesAdminOfTier)
  // lets any of them act on it, and rejects one from another Department.
  // A Request-linked expense sent back (REVISION) waits for Corsec's "Update Invoice" on the
  // Expense Request list - the backend refuses to approve it until then.
  // There is deliberately no Reject button on this page (rejecting happens from the
  // Pending Approval list).
  const awaitingCorsecInvoice = expense?.status === 'REVISION' && !!expense.expenseRequestId;
  const isSalesAdminTier = currentStepInfo?.position.code === 'SLSADM' && hasRole('SALES_ADMIN');
  const canAct =
    !!currentStepInfo &&
    !awaitingCorsecInvoice &&
    (currentStepInfo.resolvedApprover?.id === user?.id || hasRole('ADMINISTRATOR') || isSalesAdminTier);
  // Flower Bouquet at the Sales Admin tier: Approve stays disabled until the expense is matched.
  const approveBlocked = mustMatchBeforeApprove(expense, currentStepInfo?.position.code);
  // Sends a DRAFT / PENDING_SALES_ADMIN expense into the approval chain - shown in the page
  // header and as the "Submit" button of the Edit Expense form (not while Approve/Revise apply).
  const showSubmitButton =
    canEditFields && !(salesAdminActsDirectly || canAct) && (expense?.status === 'DRAFT' || expense?.status === 'PENDING_SALES_ADMIN');
  const canMatch = hasRole('ADMINISTRATOR') || hasPermission('expense.match.all', 'expense.match.owndept');
  const matchedTxn = expense?.bankTransactions.find((t) => MATCHED_TXN_STATUSES.includes(t.status)) ?? null;

  const startEditFields = () => {
    if (!expense) return;
    setEditForm({
      purpose: expense.purpose,
      amount: expense.amount,
      expenseDate: expense.expenseDate.slice(0, 10),
      merchantName: expense.merchantName ?? '',
      location: expense.location ?? '',
      paymentMethodId: expense.paymentMethodId ?? '',
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

  // ?mode=edit: open the Edit form once, as soon as the expense has loaded and the user may edit it.
  const autoEditedRef = useRef(false);
  useEffect(() => {
    if (pageMode !== 'edit' || autoEditedRef.current || !expense || !canEditFields) return;
    autoEditedRef.current = true;
    startEditFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, expense, canEditFields]);

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

  // Which button fired the Edit form: "Save as Draft" (formNoValidate) only saves,
  // "Submit" saves and then sends the expense into the approval chain.
  const submitAfterSaveRef = useRef(false);
  const [submittingForm, setSubmittingForm] = useState(false);

  // Foto Kegiatan and Foto Invoice are mandatory before the expense can go into (or
  // back into) the approval chain - checked against what is already uploaded, since
  // files are attached from the Foto/Invoice sections below, not from the edit form.
  const missingEvidenceMessage = () => {
    if (!expense) return null;
    if (expense.photos.length === 0) return 'Foto Kegiatan is required - upload at least one photo first.';
    if (!expense.invoices.some((inv) => inv.files.length > 0)) return 'Foto Invoice is required - upload at least one invoice first.';
    return null;
  };

  const saveFields = async (e: FormEvent) => {
    e.preventDefault();
    const submitAfterSave = showSubmitButton && submitAfterSaveRef.current;
    // Payment Method may stay empty while the expense is still a DRAFT, but is
    // required for every other save (REVISION resubmit, PENDING_SALES_ADMIN) and for Submit.
    const paymentMethodOptional = expense?.status === 'DRAFT' && !submitAfterSave;
    if (!editForm.expenseDate || !editForm.purpose.trim() || !editForm.amount) {
      setError('Expense Date, Purpose and Amount are required.');
      return;
    }
    if (!editForm.paymentMethodId && !paymentMethodOptional) {
      setError('Payment Method is required.');
      return;
    }
    // Enforced wherever the save hands the expense on (Submit, REVISION resubmit,
    // PENDING_SALES_ADMIN completion); a plain "Save as Draft" may still lack them.
    const handsOn = submitAfterSave || expense?.status === 'REVISION' || expense?.status === 'PENDING_SALES_ADMIN';
    const missingEvidence = handsOn ? missingEvidenceMessage() : null;
    if (missingEvidence) {
      setError(missingEvidence);
      return;
    }
    setBusy(true);
    setSubmittingForm(submitAfterSave);
    setError('');
    try {
      const validItems = editItems
        .filter((it) => it.description.trim() && it.amount)
        .map((it) => ({ description: it.description, amount: Number(it.amount), categoryId: it.categoryId || undefined }));

      const editSelectedPaymentMethod = paymentMethodOptions.find((m) => m.id === editForm.paymentMethodId);
      const payload: Record<string, unknown> = {
        purpose: editForm.purpose,
        amount: Number(editForm.amount),
        expenseDate: editForm.expenseDate || undefined,
        merchantName: editForm.merchantName || undefined,
        location: editForm.location || undefined,
        paymentMethodId: editForm.paymentMethodId || undefined,
        paymentMethodNote: editForm.paymentMethodNote || undefined,
        creditCardId: editSelectedPaymentMethod?.code === 'CORPORATE_CARD' ? editForm.creditCardId || undefined : undefined,
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
      if (submitAfterSave) await api.post(`/expenses/${id}/submit`);
      setEditingFields(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : submitAfterSave ? 'Submit failed' : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    const missingEvidence = missingEvidenceMessage();
    if (missingEvidence) {
      setError(missingEvidence);
      return;
    }
    setBusy(true);
    try {
      await api.post(`/expenses/${id}/submit`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed');
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

  // Sends the expense back exactly one approval tier instead of rejecting it
  // outright - the owner can then edit and resubmit at that same tier.
  const revise = async () => {
    const reason = await prompt({ title: 'Revise reason (send back one tier)', danger: true });
    if (!reason) return;
    setBusy(true);
    try {
      await api.post(`/approvals/expense/${id}/revise`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revise failed');
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

  const resetInvoiceForm = () => {
    setInvoiceFiles([]);
    setInvoiceScanNote('');
    setShowInvoiceForm(false);
  };

  // Picking invoice images also OCRs them (best-effort, never blocks the upload)
  // and, when a transaction date is found, puts it in the Edit Expense form's
  // Expense Date - opening that form first if needed, so the user reviews and
  // saves it there (nothing is written until they click Save). First scanned
  // date wins, and a date already changed by hand in the form is left alone.
  const onInvoiceFilesPicked = async (files: File[]) => {
    setInvoiceFiles((prev) => [...prev, ...files]);
    if (!canEditFields || !expense) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setScanningInvoice(true);
    try {
      for (const file of images) {
        try {
          const result = (await uploadFile('/invoices/ocr-scan', file)) as { invoiceDate: string | null };
          if (!result.invoiceDate) continue;
          const original = expense.expenseDate.slice(0, 10);
          if (!editingFields) startEditFields();
          setEditForm((f) => (f.expenseDate === original ? { ...f, expenseDate: result.invoiceDate as string } : f));
          setInvoiceScanNote(`Invoice date ${formatDate(result.invoiceDate)} set in Edit Expense - review and Save.`);
          break;
        } catch (err) {
          // OCR is best-effort: the invoice still uploads normally - but tell the user the scan failed, once.
          void alert({
            title: 'OCR scan failed',
            message: `${err instanceof ApiError ? err.message : `OCR scan failed for ${file.name}.`} The invoice will still upload; set the Expense Date by hand if needed.`,
          });
          break;
        }
      }
    } finally {
      setScanningInvoice(false);
    }
  };

  const addInvoice = async (e: FormEvent) => {
    e.preventDefault();
    if (invoiceFiles.length === 0) {
      setError('Upload at least one invoice photo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Total defaults to the Expense amount; it can still be corrected per Invoice afterwards.
      const invoice = await api.post<{ id: string }>(`/expenses/${id}/invoices`, {
        finalTotal: expense ? Number(expense.amount) : undefined,
      });
      for (const file of invoiceFiles) {
        await uploadFile(`/invoices/${invoice.id}/files`, file);
      }
      resetInvoiceForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add invoice failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadInvoiceFiles = async (invoiceId: string, files: File[]) => {
    setBusy(true);
    try {
      for (const file of files) {
        await uploadFile(`/invoices/${invoiceId}/files`, file);
      }
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

  const uploadActivityPhotos = async () => {
    if (photoFiles.length === 0) return;
    setBusy(true);
    setError('');
    try {
      for (const file of photoFiles) {
        await uploadFile(`/expenses/${id}/photos`, file);
      }
      setPhotoFiles([]);
      setShowPhotoForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !expense) return <div className="error-text">{error}</div>;
  if (!expense) return <SplashLoader message="Loading" />;

  const editSelectedPaymentMethodCode = paymentMethodOptions.find((m) => m.id === editForm.paymentMethodId)?.code;

  return (
    <div>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn"
            onClick={() => router.back()}
            title="Back to list"
          >
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>{expense.expenseNo}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="badge badge-info">{expense.status}</span>
          <span className={`badge ${expense.isMatched ? 'badge-success' : 'badge-info'}`}>{expense.isMatched ? 'Matched' : 'Not Matched'}</span>
          {expense.settlement && <span className="badge badge-info">{expense.settlement.settlementNo}</span>}
          {expense.settlement && (
            <span
              className={`badge ${
                expense.settlement.odooSyncStatus === 'SENT'
                  ? 'badge-success'
                  : expense.settlement.odooSyncStatus === 'FAILED'
                  ? 'badge-danger'
                  : 'badge-warning'
              }`}
              title={expense.settlement.odooSyncStatus === 'FAILED' ? expense.settlement.odooSyncError ?? '' : undefined}
            >
              Odoo: {expense.settlement.odooSyncStatus}
            </span>
          )}
          {canEditFields && (
            <button className="btn" onClick={() => (editingFields ? setEditingFields(false) : startEditFields())}>
              {editingFields ? 'Cancel Edit' : 'Edit'}
            </button>
          )}
          {salesAdminActsDirectly || canAct ? (
            <>
              <button
                className="btn btn-approve"
                disabled={busy || approveBlocked}
                title={approveBlocked ? MATCH_FIRST_MESSAGE : undefined}
                onClick={approve}
              >
                Approve
              </button>
              <button className="btn btn-revise" disabled={busy} onClick={revise}>
                Revise
              </button>
            </>
          ) : (
            showSubmitButton && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={submitDraft}
                title={expense.status === 'DRAFT' ? 'Send this draft into the approval chain' : 'Send this completed expense into the approval chain'}
              >
                {busy ? 'Submitting...' : 'Submit for Approval'}
              </button>
            )
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
              <label>Payment Method</label>
              <select
                required
                value={editForm.paymentMethodId}
                onChange={(e) => setEditForm({ ...editForm, paymentMethodId: e.target.value, creditCardId: '', paymentMethodNote: '' })}
              >
                <option value="">Select...</option>
                {paymentMethodOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            {editSelectedPaymentMethodCode === 'CORPORATE_CARD' && (
              <div className="form-row">
                <label>Corporate Card</label>
                <select
                  required
                  disabled={!expense.department}
                  value={editForm.creditCardId}
                  onChange={(e) => setEditForm({ ...editForm, creditCardId: e.target.value })}
                >
                  <option value="">{expense.department ? 'Select card' : 'This expense has no Department'}</option>
                  {creditCardOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.bank} •••• {c.last4} ({c.user?.name ?? '-'})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {editSelectedPaymentMethodCode && editSelectedPaymentMethodCode !== 'CORPORATE_CARD' && (
              <div className="form-row">
                <label style={{ fontSize: 12 }}>Note (optional)</label>
                <input value={editForm.paymentMethodNote} onChange={(e) => setEditForm({ ...editForm, paymentMethodNote: e.target.value })} />
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
                    .filter((a) => a.id !== expense.advertiser?.id && !editExtraAdvertisers.some((s) => s.id === a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>Additional Brands (beyond the primary Brand {expense.brand?.name ?? '-'})</label>
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
                className="check-grid"
                style={{
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                {brandOptions
                  .filter((b) => b.id !== expense.brand?.id)
                  .map((b) => (
                    <label key={b.id} className="check-item">
                      <input type="checkbox" checked={editExtraBrands.some((sb) => sb.id === b.id)} onChange={() => toggleExtraBrand(b)} />
                      {b.name}
                    </label>
                  ))}
                {brandOptions.filter((b) => b.id !== expense.brand?.id).length === 0 && (
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

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            {showSubmitButton ? (
              <>
                <button
                  className="btn"
                  type="submit"
                  formNoValidate={expense.status === 'DRAFT'}
                  disabled={busy || !editForm.expenseDate}
                  onClick={() => {
                    submitAfterSaveRef.current = false;
                  }}
                >
                  {busy && !submittingForm ? 'Saving...' : expense.status === 'DRAFT' ? 'Save as Draft' : 'Save Changes'}
                </button>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={busy || !editForm.expenseDate}
                  onClick={() => {
                    submitAfterSaveRef.current = true;
                  }}
                  title="Save the changes and send this expense into the approval chain"
                >
                  {busy && submittingForm ? 'Submitting...' : 'Submit'}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" type="submit" disabled={busy || !editForm.expenseDate}>
                {busy ? 'Saving...' : expense.status === 'REVISION' ? 'Resubmit' : 'Save Changes'}
              </button>
            )}
          </div>
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
                {expense.paymentMethod?.name ?? '-'}
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

        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>Invoices</h3>
          {canUploadFiles && (
            <button className="btn" onClick={() => (showInvoiceForm ? resetInvoiceForm() : setShowInvoiceForm(true))}>
              {showInvoiceForm ? 'Cancel' : '+ Add Invoice'}
            </button>
          )}
        </div>

        {showInvoiceForm && (
          <form onSubmit={addInvoice} style={{ marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
            <div className="form-row">
              <label>Foto Invoice * (image/pdf, bisa lebih dari 1)</label>
              <FileOrCameraInput
                accept="image/jpeg,image/png,image/webp,application/pdf"
                cameraTitle="Scan Invoice"
                disabled={busy}
                onFiles={onInvoiceFilesPicked}
              />
              {scanningInvoice && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Scanning invoice...</div>}
              {invoiceScanNote && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{invoiceScanNote}</div>}
              {invoiceFiles.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {invoiceFiles.map((f, i) => (
                    <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setInvoiceFiles((prev) => prev.filter((_, idx) => idx !== i))} />
                  ))}
                </div>
              )}
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || invoiceFiles.length === 0} style={{ marginTop: 12 }}>
              {busy ? 'Saving...' : 'Save Invoice'}
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
                  {canUploadFiles && (
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
            {canUploadFiles && (
              <div style={{ marginTop: 8 }}>
                <FileOrCameraInput
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  cameraTitle="Scan Invoice"
                  disabled={busy}
                  onFiles={(files) => uploadInvoiceFiles(inv.id, files)}
                />
              </div>
            )}
          </div>
        ))}
        {expense.invoices.length === 0 && <div style={{ color: 'var(--muted)' }}>No invoices attached</div>}
      </div>

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>Foto Kegiatan *</h3>
          {canUploadFiles && (
            <button
              className="btn"
              onClick={() => {
                if (showPhotoForm) setPhotoFiles([]);
                setShowPhotoForm((v) => !v);
              }}
            >
              {showPhotoForm ? 'Cancel' : '+ Add Foto Kegiatan'}
            </button>
          )}
        </div>
        {showPhotoForm && (
          <div style={{ marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
            <FileOrCameraInput
              accept="image/jpeg,image/png,image/webp"
              cameraTitle="Foto Kegiatan"
              disabled={busy}
              onFiles={(files) => setPhotoFiles((prev) => [...prev, ...files])}
            />
            {photoFiles.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {photoFiles.map((f, i) => (
                  <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setPhotoFiles((prev) => prev.filter((_, idx) => idx !== i))} />
                ))}
              </div>
            )}
            <button className="btn btn-primary" disabled={busy || photoFiles.length === 0} style={{ marginTop: 12 }} onClick={uploadActivityPhotos}>
              {busy ? 'Uploading...' : `Upload (${photoFiles.length})`}
            </button>
          </div>
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
          <h3 style={{ marginTop: 0 }}>Approval Trail</h3>
          <div>
            Status: <span className="badge">{approval.status}</span>
          </div>
          <div className="trail-chain">
            {[...approval.steps]
              .sort((a, b) => a.stepOrder - b.stepOrder)
              .map((s) => {
                const state =
                  s.status === 'REJECTED'
                    ? 'rejected'
                    : s.status === 'APPROVED'
                    ? 'done'
                    : s.stepOrder === approval.currentStep && approval.status === 'PENDING'
                    ? 'current'
                    : '';
                return (
                  <span key={s.stepOrder} className={`trail-step ${state}`}>
                    <span className="trail-step-num">{state === 'done' ? '✓' : state === 'rejected' ? '✕' : s.stepOrder + 1}</span>
                    <span>
                      {s.position.name}
                      <small>{s.resolvedApprover?.name}</small>
                    </span>
                  </span>
                );
              })}
          </div>
          {approval.actions.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>No actions yet</div>
          ) : (
            <ol className="trail-list">
              {approval.actions.map((a) => {
                const rejected = a.action === 'REJECT';
                const tone = rejected ? 'var(--danger)' : a.action === 'APPROVE' ? 'var(--success)' : 'var(--primary)';
                return (
                  <li key={a.id} className="trail-item">
                    <span className="trail-dot" style={{ ['--tone' as string]: tone }}>
                      {rejected ? '✕' : a.action === 'APPROVE' ? '✓' : '•'}
                    </span>
                    <div className="trail-head">
                      <strong>{a.action}</strong>
                      {a.position?.name && <span className="badge">{a.position.name}</span>}
                      <span className="trail-when">{formatDateTime(a.actedAt)}</span>
                    </div>
                    <div className="trail-who">by {a.actor?.name}</div>
                    {a.reason && (
                      <div className="trail-reason" style={{ ['--tone' as string]: tone }}>
                        {a.reason}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
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
