'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import NumberInput from '@/components/NumberInput';
import LocationPicker from '@/components/LocationPicker';
import FileThumb from '@/components/FileThumb';
import LocalFileThumb from '@/components/LocalFileThumb';
import SplashLoader from '@/components/SplashLoader';
import { StatusBadge } from '@/lib/mobileUi';

// Phone-first Expense form for Sales (Android Chrome / iOS Safari), shared by
// New Expense (m/expense/new) and Edit Expense (m/expense/[id]/edit) so both
// look and behave identically - the only difference is that edit mode loads
// and pre-fills an existing (DRAFT) Expense instead of starting blank, and
// saves via PATCH (+ an explicit Submit call) instead of POST. One column,
// 16px inputs (iOS Safari zooms into anything smaller), 44px touch targets,
// native date picker, and camera capture for activity/invoice photos.

interface Option {
  id: string;
  name: string;
}
interface PaymentMethodOption extends Option {
  code: string;
}
interface BrandOption extends Option {
  advertiserId: string;
}
interface ParticipantRow {
  company: string; // agency / advertiser name - only ever one of the selected ones
  name: string;
  position: string;
}
const emptyParticipant = (company: string): ParticipantRow => ({ company, name: '', position: '' });
interface InternalParticipantRow {
  unitId: string;
  name: string;
  position: string;
}
const emptyInternalParticipant = (): InternalParticipantRow => ({ unitId: '', name: '', position: '' });
interface CreditCardOption {
  id: string;
  bank: string;
  last4: string;
  user: { id: string; name: string } | null;
}
interface ParsedReceipt {
  merchantName: string | null;
  invoiceDate: string | null;
  subtotal: number | null;
  tax: number | null;
  serviceCharge: number | null;
  total: number | null;
  confidence: number;
  warnings: string[];
}
interface UploadedFileRow {
  id: string;
  fileName: string;
  mimeType: string;
}
interface ExpenseDetail {
  status: string;
  expenseDate: string;
  purpose: string;
  amount: string;
  merchantName: string | null;
  location: string | null;
  paymentMethodId: string | null;
  paymentMethodNote: string | null;
  creditCardId: string | null;
  department: Option | null;
  unit: Option;
  activityType: Option;
  advertiser: Option | null; // null: raised from an Agency-only Expense Request
  brand: BrandOption | null;
  extraAgencies: { agency: Option }[];
  extraAdvertisers: { advertiser: Option }[];
  extraBrands: { brand: BrandOption }[];
  participants: { category: string; name: string; position: string | null; company: string | null; unitId: string | null }[];
  photos: UploadedFileRow[];
  invoices: { id: string; files: UploadedFileRow[] }[];
}

const MAX_EDGE = 1600;

// Phone photos are 3-12MB; the API caps uploads at 10MB and only takes
// jpeg/png/webp. Re-encoding through a canvas shrinks them and also turns
// HEIC/odd formats into JPEG. Falls back to the original file on any failure.
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ExistingFileGrid({ files, downloadPath }: { files: UploadedFileRow[]; downloadPath: (id: string) => string }) {
  if (files.length === 0) return null;
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 6px' }}>
        Uploaded ({files.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        {files.map((f) => (
          <FileThumb key={f.id} path={downloadPath(f.id)} fileName={f.fileName} isImage={f.mimeType.startsWith('image/')} />
        ))}
      </div>
    </>
  );
}

// New, not-yet-uploaded photos - same thumbnail style as ExistingFileGrid
// (LocalFileThumb mirrors FileThumb) so the row doesn't visibly change once
// save() finishes uploading and the page reloads from the server.
function NewPhotoGrid({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (files.length === 0) return null;
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '10px 0 6px' }}>
        New - not yet saved ({files.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {files.map((f, i) => (
          <LocalFileThumb key={i} file={f} onRemove={() => onRemove(i)} />
        ))}
      </div>
    </>
  );
}

// lockedIds: ids rendered without a remove button.
function Chips({ items, onRemove, lockedIds = [] }: { items: Option[]; onRemove: (id: string) => void; lockedIds?: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {items.map((o) => (
        <span key={o.id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, padding: '6px 10px' }}>
          {o.name}
          {!lockedIds.includes(o.id) && (
            <button type="button" onClick={() => onRemove(o.id)} aria-label={`Remove ${o.name}`} style={{ border: 'none', background: 'none', color: 'inherit', fontSize: 18, lineHeight: 1, padding: 0 }}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

// Always shows the placeholder; picking an option adds it and resets the select.
function AddSelect({ options, placeholder, onPick, style }: { options: Option[]; placeholder: string; onPick: (id: string) => void; style: React.CSSProperties }) {
  return (
    <select value="" onChange={(e) => e.target.value && onPick(e.target.value)} style={style} disabled={options.length === 0}>
      <option value="">{options.length === 0 ? 'No more options' : placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

// Company combobox only lists the Agencies/Advertisers already picked above.
function ParticipantSection({
  title,
  companyLabel,
  companies,
  rows,
  setRows,
  field,
}: {
  title: string;
  companyLabel: string;
  companies: Option[];
  rows: ParticipantRow[];
  setRows: (fn: (prev: ParticipantRow[]) => ParticipantRow[]) => void;
  field: React.CSSProperties;
}) {
  const update = (i: number, patch: Partial<ParticipantRow>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="form-row">
      <label>{title} (optional)</label>
      {companies.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Pick {companyLabel.toLowerCase().replace(' name', '')} above first</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8, display: 'grid', gap: 8 }}>
          <select value={r.company} onChange={(e) => update(i, { company: e.target.value })} style={field}>
            <option value="">{companyLabel}...</option>
            {companies.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          <input placeholder="Participant name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} style={field} />
          <input placeholder="Jabatan / position" value={r.position} onChange={(e) => update(i, { position: e.target.value })} style={field} />
          <button type="button" className="btn btn-danger" style={{ minHeight: 40 }} onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        style={{ minHeight: 44, width: '100%', justifyContent: 'center' }}
        disabled={companies.length === 0}
        onClick={() => setRows((p) => [...p, emptyParticipant(companies.length === 1 ? companies[0].name : '')])}
      >
        + Add participant
      </button>
    </div>
  );
}

// Internal (Employee) participants - Unit picked from a dropdown (unitId, not
// free text) instead of the Agency/Advertiser sections' company combobox, same
// shape as the mobile app's Internal Participants section.
function InternalParticipantSection({
  units,
  rows,
  setRows,
  field,
}: {
  units: Option[];
  rows: InternalParticipantRow[];
  setRows: (fn: (prev: InternalParticipantRow[]) => InternalParticipantRow[]) => void;
  field: React.CSSProperties;
}) {
  const update = (i: number, patch: Partial<InternalParticipantRow>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="form-row">
      <label>Internal Participant (optional)</label>
      {rows.map((r, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8, display: 'grid', gap: 8 }}>
          <select value={r.unitId} onChange={(e) => update(i, { unitId: e.target.value })} style={field}>
            <option value="">Unit...</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <input placeholder="Participant name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} style={field} />
          <input placeholder="Jabatan / position" value={r.position} onChange={(e) => update(i, { position: e.target.value })} style={field} />
          <button type="button" className="btn btn-danger" style={{ minHeight: 40 }} onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        style={{ minHeight: 44, width: '100%', justifyContent: 'center' }}
        onClick={() => setRows((p) => [...p, emptyInternalParticipant()])}
      >
        + Add participant
      </button>
    </div>
  );
}

export default function ExpenseForm({ expenseId }: { expenseId?: string }) {
  const isEdit = !!expenseId;
  const router = useRouter();
  const { user, hasRole, hasPermission } = useAuth();
  const toast = useToast();

  // expense.create.all / .owndept (or the Web Mobile webmobile.expense.create.owndept, or Admin): key the
  // Expense in on another user's behalf - the requestor stays that user. Anyone who can't create their
  // own (e.g. Sales Admin) must pick one.
  const canPickRequestor =
    !isEdit && (hasRole('ADMINISTRATOR') || hasPermission('expense.create.all', 'expense.create.owndept', 'webmobile.expense.create.owndept'));
  const requestorRequired = canPickRequestor && !(hasRole('SALES') || hasPermission('expense.create.own', 'webmobile.expense.create.own'));
  // Admin / expense.create.all may pick any Department; everyone else only their own (the API enforces it too).
  const canAnyDepartment = canPickRequestor && (hasRole('ADMINISTRATOR') || hasPermission('expense.create.all'));
  const [requestors, setRequestors] = useState<{ id: string; name: string; employeeId: string; unitId?: string | null; departmentIds?: string[] }[]>([]);
  const [requestorId, setRequestorId] = useState('');

  const [units, setUnits] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [activityTypes, setActivityTypes] = useState<Option[]>([]);
  const [agencies, setAgencies] = useState<Option[]>([]);
  const [advertisers, setAdvertisers] = useState<Option[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selAgencies, setSelAgencies] = useState<Option[]>([]);
  const [selAdvertisers, setSelAdvertisers] = useState<Option[]>([]);
  const [selBrands, setSelBrands] = useState<BrandOption[]>([]);
  const [agencyParticipants, setAgencyParticipants] = useState<ParticipantRow[]>([]);
  const [advertiserParticipants, setAdvertiserParticipants] = useState<ParticipantRow[]>([]);
  const [internalParticipants, setInternalParticipants] = useState<InternalParticipantRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [cards, setCards] = useState<CreditCardOption[]>([]);

  const [form, setForm] = useState({
    expenseDate: todayIso(),
    purpose: '',
    amount: '',
    departmentId: '',
    unitId: user?.unitId ?? '',
    activityTypeId: '',
    paymentMethodId: '',
    paymentMethodNote: '',
    creditCardId: '',
    merchantName: '',
    location: '',
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [invoices, setInvoices] = useState<File[]>([]);
  const [ocr, setOcr] = useState<ParsedReceipt | null>(null);
  const [scanning, setScanning] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locStatus, setLocStatus] = useState<{ tone: 'info' | 'ok' | 'error'; text: string }>({ tone: 'info', text: 'Detecting your location...' });
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  // Expense Date is owned by the user once they've picked it by hand, or once a
  // scanned invoice has supplied it (first scanned date wins) - an OCR result
  // must never overwrite either. Until then a scan replaces the default
  // (today / the loaded Expense's date).
  const dateLocked = useRef(false);
  // The invoice file the current scan result belongs to, and what that scan filled into the form
  // (see scanInvoice / clearOcr). formRef gives async code the latest form without a stale closure.
  const ocrFile = useRef<File | null>(null);
  const ocrFilled = useRef<{ merchantName?: string; amount?: string; expenseDate?: string; previousDate?: string }>({});

  // Edit mode only: the loaded Expense's current state.
  const [loadingExpense, setLoadingExpense] = useState(isEdit);
  const [loadError, setLoadError] = useState('');
  const [expenseStatus, setExpenseStatus] = useState<string | null>(null);
  const [existingActivityTypeName, setExistingActivityTypeName] = useState('');
  const [existingPhotos, setExistingPhotos] = useState<UploadedFileRow[]>([]);
  const [existingInvoices, setExistingInvoices] = useState<{ id: string; files: UploadedFileRow[] }[]>([]);

  const photoCamera = useRef<HTMLInputElement>(null);
  const photoGallery = useRef<HTMLInputElement>(null);
  const invoiceCamera = useRef<HTMLInputElement>(null);
  const invoiceGallery = useRef<HTMLInputElement>(null);

  const formRef = useRef(form);
  formRef.current = form;

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api.get<Option[]>('/units?active=true').then(setUnits).catch(() => undefined);
    api
      .get<Option[]>('/activity-types?active=true')
      .then((all) => {
        // New Expense is Entertainment only (Flower Bouquet comes from an Expense Request). When editing,
        // keep the Expense's own Activity Type selectable so the field doesn't go blank.
        const entertainment = all.filter((a) => a.name === 'Entertainment');
        setActivityTypes(entertainment);
        if (!isEdit && entertainment.length === 1) setForm((f) => ({ ...f, activityTypeId: f.activityTypeId || entertainment[0].id }));
      })
      .catch(() => undefined);
    api.get<PaymentMethodOption[]>('/payment-methods?active=true').then(setPaymentMethods).catch(() => undefined);
    if (canPickRequestor) {
      api.get<typeof requestors>('/expenses/requestors').then(setRequestors).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Department comes first: the caller's own Department(s) (every active one for Admin /
  // expense.create.all). The Requestor list, Corporate card list and the rest of the form
  // follow whichever Department is picked.
  useEffect(() => {
    let cancelled = false;
    api
      .get<Option[]>(canAnyDepartment ? '/departments?active=true' : '/departments/me')
      .then((list) => {
        if (cancelled) return;
        // Ascending by name, numeric-aware so POD 2 comes before POD 10; the first one is the default pick.
        const d = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        setDepartments(d);
        if (d.length > 0) setForm((f) => (f.departmentId ? f : { ...f, departmentId: d[0].id }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Requestors who belong to the picked Department (the caller themself is the "Myself" option).
  const departmentRequestors = requestors.filter((r) => r.id !== user?.id && !!form.departmentId && !!r.departmentIds?.includes(form.departmentId));

  const changeDepartment = (departmentId: string) => {
    // Corporate card belongs to the Department. The requestor stays only while still a member of
    // the new Department; otherwise fall back to Myself / unpicked and re-derive the Unit.
    const keep = !requestorId || !!requestors.find((r) => r.id === requestorId)?.departmentIds?.includes(departmentId);
    if (!keep) setRequestorId('');
    setForm((f) => ({ ...f, departmentId, creditCardId: '', unitId: keep ? f.unitId : '' }));
  };

  useEffect(() => {
    const unitId = requestorId ? requestors.find((r) => r.id === requestorId)?.unitId : requestorRequired ? undefined : user?.unitId;
    if (unitId) setForm((f) => (f.unitId ? f : { ...f, unitId }));
  }, [user?.unitId, requestorId, requestors, requestorRequired]);

  // Edit mode: load the existing (DRAFT) Expense and pre-fill everything -
  // same shape the create flow builds up interactively. Re-run after a
  // "stay a draft" save so the form reflects whatever the server persisted.
  const loadExpense = useCallback(() => {
    if (!expenseId) return;
    setLoadingExpense(true);
    setLoadError('');
    return api
      .get<ExpenseDetail>(`/expenses/${expenseId}`)
      .then((e) => {
        setExpenseStatus(e.status);
        setExistingActivityTypeName(e.activityType.name);
        setForm({
          expenseDate: e.expenseDate.slice(0, 10),
          purpose: e.purpose,
          amount: e.amount,
          departmentId: e.department?.id ?? '',
          unitId: e.unit.id,
          activityTypeId: e.activityType.id,
          paymentMethodId: e.paymentMethodId ?? '',
          paymentMethodNote: e.paymentMethodNote ?? '',
          creditCardId: e.creditCardId ?? '',
          merchantName: e.merchantName ?? '',
          location: e.location ?? '',
        });
        setSelAdvertisers([...(e.advertiser ? [e.advertiser] : []), ...e.extraAdvertisers.map((x) => x.advertiser)]);
        setSelBrands([...(e.brand ? [e.brand] : []), ...e.extraBrands.map((x) => x.brand)]);
        setSelAgencies(e.extraAgencies.map((x) => x.agency));
        setAgencyParticipants(
          e.participants.filter((p) => p.category === 'AGENCY').map((p) => ({ company: p.company ?? '', name: p.name, position: p.position ?? '' })),
        );
        setAdvertiserParticipants(
          e.participants.filter((p) => p.category === 'ADVERTISER').map((p) => ({ company: p.company ?? '', name: p.name, position: p.position ?? '' })),
        );
        setInternalParticipants(
          e.participants.filter((p) => p.category === 'EMPLOYEE').map((p) => ({ unitId: p.unitId ?? '', name: p.name, position: p.position ?? '' })),
        );
        setExistingPhotos(e.photos);
        setExistingInvoices(e.invoices);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load this expense'))
      .finally(() => setLoadingExpense(false));
  }, [expenseId]);

  useEffect(() => {
    loadExpense();
  }, [loadExpense]);

  // Brand options follow whichever Advertisers are picked, so Brand always matches Advertiser.
  const advertiserIds = selAdvertisers.map((a) => a.id).join(',');
  useEffect(() => {
    if (!advertiserIds) {
      setBrands([]);
      return;
    }
    api.get<BrandOption[]>(`/brands?advertiserIds=${advertiserIds}&active=true`).then(setBrands).catch(() => undefined);
  }, [advertiserIds]);

  const addAgency = (id: string) => {
    const a = agencies.find((x) => x.id === id);
    if (a) setSelAgencies((p) => (p.some((s) => s.id === a.id) ? p : [...p, a]));
  };
  const removeAgency = (id: string) => {
    const gone = selAgencies.find((a) => a.id === id);
    setSelAgencies((p) => p.filter((a) => a.id !== id));
    if (gone) setAgencyParticipants((p) => p.filter((r) => r.company !== gone.name));
  };
  const addAdvertiser = (id: string) => {
    const a = advertisers.find((x) => x.id === id);
    if (a) setSelAdvertisers((p) => (p.some((s) => s.id === a.id) ? p : [...p, a]));
  };
  const removeAdvertiser = (id: string) => {
    const gone = selAdvertisers.find((a) => a.id === id);
    setSelAdvertisers((p) => p.filter((a) => a.id !== id));
    setSelBrands((p) => p.filter((b) => b.advertiserId !== id));
    if (gone) setAdvertiserParticipants((p) => p.filter((r) => r.company !== gone.name));
  };
  const toggleBrand = (b: BrandOption) =>
    setSelBrands((p) => (p.some((s) => s.id === b.id) ? p.filter((s) => s.id !== b.id) : [...p, b]));

  // Location is read-only: it only ever comes from the device's GPS. Detected automatically once on
  // open (a saved Expense keeps the position it already has), and again on demand via the pin button.
  // High accuracy first (GPS), then a coarse network fix if that times out or is unavailable.
  // Status is shown under the field instead of failing silently.
  const detectLocation = (auto: boolean) => {
    if (!window.isSecureContext) {
      setLocStatus({ tone: 'error', text: 'Location needs a secure (HTTPS) connection.' });
      return;
    }
    if (!navigator.geolocation) {
      setLocStatus({ tone: 'error', text: 'This browser cannot detect location.' });
      return;
    }
    setLocating(true);
    setLocStatus({ tone: 'info', text: 'Detecting your location...' });
    const onOk = (pos: GeolocationPosition) => {
      const value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      setForm((f) => (auto && f.location ? f : { ...f, location: value }));
      setLocStatus({ tone: 'ok', text: `Location detected from GPS (accuracy about ${Math.round(pos.coords.accuracy)} m).` });
      setLocating(false);
    };
    const onFail = (err: GeolocationPositionError) => {
      setLocStatus({
        tone: 'error',
        text:
          err.code === err.PERMISSION_DENIED
            ? 'Location permission is blocked - allow it in the browser/site settings and turn GPS on, then tap the pin.'
            : 'Could not get your location - turn GPS on and tap the pin to retry.',
      });
      setLocating(false);
    };
    navigator.geolocation.getCurrentPosition(
      onOk,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) return onFail(err);
        navigator.geolocation.getCurrentPosition(onOk, onFail, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  };

  useEffect(() => {
    // Skip while an existing Expense is still loading, and skip entirely for a
    // read-only (non-DRAFT) one - there's nothing to fill in.
    if (isEdit && loadingExpense) return;
    if (isEdit && expenseStatus !== 'DRAFT') return;
    detectLocation(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingExpense]);

  useEffect(() => {
    if (!form.departmentId) {
      setCards([]);
      return;
    }
    api.get<CreditCardOption[]>(`/credit-cards?departmentId=${form.departmentId}&active=true`).then(setCards).catch(() => undefined);
  }, [form.departmentId]);

  // Agency / Advertiser options are what the picked Department covers; nothing picked yet shows them all.
  useEffect(() => {
    // `cancelled` drops a slower, stale response (e.g. the unfiltered one fired before the Department was known).
    let cancelled = false;
    const qs = form.departmentId ? `&departmentIds=${form.departmentId}` : '';
    api.get<Option[]>(`/agencies?active=true${qs}`).then((r) => !cancelled && setAgencies(r)).catch(() => undefined);
    api.get<Option[]>(`/advertisers?active=true${qs}`).then((r) => !cancelled && setAdvertisers(r)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [form.departmentId]);

  const paymentCode = paymentMethods.find((m) => m.id === form.paymentMethodId)?.code;

  const addPhotos = async (list: FileList | null) => {
    if (!list?.length) return;
    const compressed = await Promise.all(Array.from(list).map(compressImage));
    setPhotos((p) => [...p, ...compressed]);
  };

  // Only the FIRST invoice picked is OCR'd (AWS Textract), right away, and
  // prefills merchant/amount (only fields still empty, so manual edits are never
  // overwritten) and the Expense Date (the transaction date on the invoice,
  // unless already set - see dateLocked). Later invoices are only attached. The
  // backend only OCRs images, so a PDF as first invoice is attached without a
  // scan. OCR is best-effort - failure never blocks manual entry.
  const addInvoices = async (list: FileList | null) => {
    if (!list?.length) return;
    setNotice('');
    const isFirstInvoice = invoices.length === 0;
    const picked = await Promise.all(Array.from(list).map(compressImage));
    setInvoices((p) => [...p, ...picked]);
    const first = picked[0];
    if (!isFirstInvoice || !first) return;
    await scanInvoice(first);
  };

  const scanInvoice = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    ocrFile.current = file;
    setScanning(true);
    try {
      const result = (await uploadFile('/invoices/ocr-scan', file)) as ParsedReceipt;
      // The scanned invoice was removed (or replaced) while the scan was running - drop the result.
      if (ocrFile.current !== file) return;
      setOcr(result);
      const current = formRef.current;
      const scannedDate = !dateLocked.current ? result.invoiceDate : null;
      if (scannedDate) dateLocked.current = true;
      const scannedAmount = result.total != null ? String(result.total) : '';
      // Remember exactly what the scan filled in, so removing this invoice can undo just that.
      ocrFilled.current = {
        merchantName: !current.merchantName && result.merchantName ? result.merchantName : undefined,
        amount: !current.amount && scannedAmount ? scannedAmount : undefined,
        expenseDate: scannedDate ?? undefined,
        previousDate: current.expenseDate,
      };
      setForm((f) => ({
        ...f,
        merchantName: f.merchantName || result.merchantName || '',
        amount: f.amount || scannedAmount,
        expenseDate: scannedDate ?? f.expenseDate,
      }));
      setNotice(
        result.total != null
          ? `Invoice scanned - please check the merchant, amount${scannedDate ? ' and date' : ''} below.`
          : 'Invoice scanned but no total was found - enter the amount manually.',
      );
    } catch (err) {
      if (ocrFile.current === file) setNotice(err instanceof ApiError ? `Scan failed: ${err.message}` : 'Scan failed - enter the details manually.');
    } finally {
      if (ocrFile.current === file || ocrFile.current === null) setScanning(false);
    }
  };

  // Undo what the scan of the first invoice put into the form: Merchant, Amount and Date go back to
  // empty / their previous value - but only those still holding the scanned value, so anything the
  // user has typed over since is kept.
  const clearOcr = () => {
    const filled = ocrFilled.current;
    const current = formRef.current;
    ocrFilled.current = {};
    ocrFile.current = null;
    setOcr(null);
    setNotice('');
    setForm((f) => ({
      ...f,
      merchantName: filled.merchantName !== undefined && current.merchantName === filled.merchantName ? '' : f.merchantName,
      amount: filled.amount !== undefined && current.amount === filled.amount ? '' : f.amount,
      expenseDate: filled.expenseDate !== undefined && current.expenseDate === filled.expenseDate ? filled.previousDate ?? f.expenseDate : f.expenseDate,
    }));
    if (filled.expenseDate !== undefined && current.expenseDate === filled.expenseDate) dateLocked.current = false;
  };

  // Removing the first invoice drops its scan result; the next one in line becomes the first invoice
  // and is scanned in its place (same rule as picking it first).
  const removeInvoice = (index: number) => {
    const rest = invoices.filter((_, j) => j !== index);
    setInvoices(rest);
    if (index !== 0) return;
    clearOcr();
    if (rest[0]) void scanInvoice(rest[0]);
  };

  // isDraft: keep the Expense out of the approval chain (still editable by
  // Sales, invisible to any approver) instead of submitting it right away.
  // In edit mode this only matters while the Expense is still DRAFT - "Save
  // as Draft" there just PATCHes, "Submit expense" PATCHes then calls the
  // submit endpoint. Once it's no longer DRAFT there's a single "Save
  // Changes" button (isDraft is passed as true, i.e. "don't touch approval").
  const save = async (isDraft: boolean) => {
    // A draft can stay incomplete (even just a scanned/uploaded invoice, the rest filled in
    // later) - everything below is required as soon as it's actually submitted into the
    // approval chain, mirroring the API's checks.
    if (!isDraft) {
      if (selAdvertisers.length === 0 || selBrands.length === 0 || !form.activityTypeId) {
        toast.warning('Advertiser, Brand and Activity Type are required.');
        return;
      }
      if (!form.paymentMethodId) {
        toast.warning('Payment method is required.');
        return;
      }
      // Invoice and activity photo are likewise only enforced on submit (already
      // saved files in edit mode count, not just the ones picked this session).
      const invoiceCount = invoices.length + existingInvoices.reduce((n, inv) => n + inv.files.length, 0);
      if (invoiceCount === 0) {
        toast.warning('Invoice is required before submitting.');
        return;
      }
      if (photos.length + existingPhotos.length === 0) {
        toast.warning('Activity photo is required before submitting.');
        return;
      }
    }
    // First pick is the mandatory "primary" Advertiser/Brand; only the rest go
    // in the extra* lists. Agency has no primary field, so every pick is sent.
    // A DRAFT's primary Advertiser/Brand can be changed too (PATCH accepts
    // them while status is DRAFT), so edit mode sends them like create does.
    const primaryAdvertiserId = selAdvertisers[0]?.id;
    const primaryBrandId = selBrands[0]?.id;
    const participants: { category: string; name: string; position?: string; company?: string; unitId?: string }[] = [
      ...[
        ...agencyParticipants.map((p) => ({ ...p, category: 'AGENCY' })),
        ...advertiserParticipants.map((p) => ({ ...p, category: 'ADVERTISER' })),
      ]
        .filter((p) => p.name.trim())
        .map((p) => ({ category: p.category, name: p.name.trim(), position: p.position.trim() || undefined, company: p.company || undefined })),
      ...internalParticipants
        .filter((p) => p.name.trim())
        .map((p) => ({ category: 'EMPLOYEE', name: p.name.trim(), position: p.position.trim() || undefined, unitId: p.unitId || undefined })),
    ];
    if (requestorRequired && !requestorId) {
      toast.warning('Pick the requestor this expense is entered for.');
      return;
    }
    if (!isDraft && !Number(form.amount)) {
      toast.warning('Amount is required.');
      return;
    }
    // An internal participant is only meaningful with the Unit they belong to.
    if (internalParticipants.some((p) => (p.name.trim() || p.position.trim()) && !p.unitId)) {
      toast.warning('Unit is required for every internal participant.');
      return;
    }
    setSaving(true);
    try {
      let targetId: string;
      const willSubmit = isEdit && expenseStatus === 'DRAFT' && !isDraft;
      if (isEdit) {
        targetId = expenseId!;
        setProgress('Saving changes...');
        // Edit mode is DRAFT-only (anything else is read-only), so every field
        // is sent - including the core ones and the extra*/participants lists,
        // as [] when emptied so removals actually persist.
        await api.patch(`/expenses/${expenseId}`, {
          expenseDate: form.expenseDate,
          purpose: form.purpose,
          amount: Number(form.amount),
          departmentId: form.departmentId || undefined,
          unitId: form.unitId || undefined,
          activityTypeId: form.activityTypeId || undefined,
          advertiserId: primaryAdvertiserId,
          brandId: primaryBrandId,
          extraAgencyIds: selAgencies.map((a) => a.id),
          extraAdvertiserIds: selAdvertisers.slice(1).map((a) => a.id),
          extraBrandIds: selBrands.slice(1).map((b) => b.id),
          participants,
          paymentMethodId: form.paymentMethodId || undefined,
          paymentMethodNote: form.paymentMethodNote || undefined,
          creditCardId: paymentCode === 'CORPORATE_CARD' ? form.creditCardId || undefined : undefined,
          merchantName: form.merchantName || undefined,
          location: form.location || undefined,
        });
        if (willSubmit) {
          setProgress('Submitting...');
          await api.post(`/expenses/${expenseId}/submit`);
        }
      } else {
        setProgress('Saving expense...');
        const created = await api.post<{ id: string }>('/expenses', {
          isDraft,
          salesId: requestorId || undefined,
          expenseDate: form.expenseDate,
          purpose: form.purpose,
          amount: Number(form.amount),
          departmentId: form.departmentId || undefined,
          unitId: form.unitId || undefined,
          activityTypeId: form.activityTypeId || undefined,
          advertiserId: primaryAdvertiserId,
          brandId: primaryBrandId,
          extraAgencyIds: selAgencies.length > 0 ? selAgencies.map((a) => a.id) : undefined,
          extraAdvertiserIds: selAdvertisers.length > 1 ? selAdvertisers.slice(1).map((a) => a.id) : undefined,
          extraBrandIds: selBrands.length > 1 ? selBrands.slice(1).map((b) => b.id) : undefined,
          participants: participants.length > 0 ? participants : undefined,
          paymentMethodId: form.paymentMethodId || undefined,
          paymentMethodNote: form.paymentMethodNote || undefined,
          creditCardId: paymentCode === 'CORPORATE_CARD' ? form.creditCardId || undefined : undefined,
          merchantName: form.merchantName || undefined,
          location: form.location || undefined,
        });
        targetId = created.id;
      }

      // The expense already exists (and, once submitted, is in approval) from
      // here on - a failed upload must not look like a failed save, so uploads
      // are reported separately.
      const failed: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setProgress(`Uploading activity photo ${i + 1}/${photos.length}...`);
        try {
          await uploadFile(`/expenses/${targetId}/photos`, photos[i]);
        } catch {
          failed.push(`photo ${i + 1}`);
        }
      }

      if (invoices.length > 0) {
        setProgress('Uploading invoice...');
        try {
          const payload: Record<string, unknown> = {};
          if (ocr) {
            payload.ocrMerchantName = ocr.merchantName ?? undefined;
            payload.ocrSubtotal = ocr.subtotal ?? undefined;
            payload.ocrTax = ocr.tax ?? undefined;
            payload.ocrServiceCharge = ocr.serviceCharge ?? undefined;
            payload.ocrTotal = ocr.total ?? undefined;
            payload.ocrConfidence = ocr.confidence ?? undefined;
          }
          if (form.merchantName) payload.finalMerchantName = form.merchantName;
          if (Number(form.amount)) payload.finalTotal = Number(form.amount);
          const invoice = await api.post<{ id: string }>(`/expenses/${targetId}/invoices`, payload);
          for (const file of invoices) {
            await uploadFile(`/invoices/${invoice.id}/files`, file);
          }
        } catch {
          failed.push('invoice');
        }
      }

      if (failed.length > 0) {
        // ToastProvider is mounted at the root layout, not this page, so this
        // still shows after the push below lands on the expense's own page.
        toast.warning(`Expense saved, but these uploads failed: ${failed.join(', ')}. Open the expense to add them again.`, { duration: 8000 });
        router.push(`/m/expense/${targetId}/edit`);
        return;
      }

      // Every successful save - draft or submit, new or edit - ends on the dashboard. A draft is
      // reopened from there (it is listed with the Sales' own expenses) when they want to continue.
      if (willSubmit) toast.success('Expense submitted for approval.');
      else if (isDraft) toast.success('Draft saved.');
      else if (isEdit) toast.success('Changes saved.');
      router.push('/m/dashboard');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
      setProgress('');
    }
  };

  // 16px font stops iOS Safari zooming the page when a field is focused;
  // 44px min height is the touch-target size Apple/Google both recommend.
  const field: React.CSSProperties = { width: '100%', fontSize: 16, minHeight: 44, boxSizing: 'border-box' };
  const bigBtn: React.CSSProperties = { minHeight: 44, fontSize: 15, flex: 1, justifyContent: 'center' };
  const hidden = { display: 'none' } as const;
  // Once an Expense leaves DRAFT it's in (or through) the approval chain -
  // opening it from the list/dashboard shows the same layout as New Expense
  // but view-only, instead of allowing edits mid-approval.
  const readOnly = isEdit && expenseStatus !== null && expenseStatus !== 'DRAFT';

  if (isEdit && loadingExpense) {
    return <SplashLoader message="Loading expense" />;
  }
  if (isEdit && loadError) {
    return (
      <div>
        <div className="error-text">{loadError}</div>
        <Link href="/m/expenses" className="btn" style={{ marginTop: 12 }}>‹ Back to expenses</Link>
      </div>
    );
  }

  const showDraftButton = !isEdit || expenseStatus === 'DRAFT';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 172 }}
    >
      <Link href={isEdit ? '/m/expenses' : '/m/dashboard'} style={{ fontSize: 14 }}>‹ Back to {isEdit ? 'expenses' : 'dashboard'}</Link>
      <h1 style={{ fontSize: 22, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        {readOnly ? 'View Expense' : isEdit ? 'Edit Expense' : 'New Expense'}
        {isEdit && expenseStatus && <StatusBadge status={expenseStatus} />}
      </h1>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Invoice *</h3>
        {isEdit && <ExistingFileGrid files={existingInvoices.flatMap((inv) => inv.files)} downloadPath={(id) => `/invoices/files/${id}/download`} />}
        {!readOnly && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" style={bigBtn} disabled={scanning} onClick={() => invoiceCamera.current?.click()}>
                {scanning ? 'Scanning...' : '📷 Scan invoice'}
              </button>
              <button type="button" className="btn" style={bigBtn} disabled={scanning} onClick={() => invoiceGallery.current?.click()}>
                🖼 Upload
              </button>
            </div>
            <input ref={invoiceCamera} type="file" accept="image/*" capture="environment" style={hidden} onChange={(e) => { addInvoices(e.target.files); e.target.value = ''; }} />
            <input ref={invoiceGallery} type="file" accept="image/*,application/pdf" multiple style={hidden} onChange={(e) => { addInvoices(e.target.files); e.target.value = ''; }} />
            <NewPhotoGrid files={invoices} onRemove={removeInvoice} />
            {notice && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>{notice}</div>}
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Activity photos *</h3>
        {isEdit && <ExistingFileGrid files={existingPhotos} downloadPath={(id) => `/expenses/photos/${id}/download`} />}
        {!readOnly && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" style={bigBtn} onClick={() => photoCamera.current?.click()}>
                📷 Take photo
              </button>
              <button type="button" className="btn" style={bigBtn} onClick={() => photoGallery.current?.click()}>
                🖼 Gallery
              </button>
            </div>
            <input ref={photoCamera} type="file" accept="image/*" capture="environment" style={hidden} onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
            <input ref={photoGallery} type="file" accept="image/*" multiple style={hidden} onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
            <NewPhotoGrid files={photos} onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))} />
          </>
        )}
      </div>

      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Details</h3>

        {departments.length > 1 && (
          <div className="form-row">
            <label>Department *</label>
            <select required value={form.departmentId} onChange={(e) => changeDepartment(e.target.value)} style={field}>
              {departments.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}

        {canPickRequestor && (
          <div className="form-row">
            <label>{requestorRequired ? 'Requestor (entry on behalf of) *' : 'Requestor'}</label>
            <select
              value={requestorId}
              onChange={(e) => {
                setRequestorId(e.target.value);
                // Unit follows the requestor - re-derive it.
                setForm((f) => ({ ...f, unitId: '' }));
              }}
              style={field}
            >
              <option value="">{requestorRequired ? 'Select requestor' : `Myself (${user?.name ?? ''})`}</option>
              {departmentRequestors.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.employeeId})</option>
              ))}
            </select>
            {requestorRequired && form.departmentId && departmentRequestors.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>No requestor available in this department</div>
            )}
          </div>
        )}

        <div className="form-row">
          <label>Date *</label>
          <input type="date" required value={form.expenseDate} onChange={(e) => { dateLocked.current = true; set({ expenseDate: e.target.value }); }} style={field} />
        </div>

        <div className="form-row">
          <label>Amount (IDR) *</label>
          <NumberInput required inputMode="numeric" value={form.amount} onChange={(v) => set({ amount: v })} style={field} placeholder="0" />
        </div>

        <div className="form-row">
          <label>Purpose *</label>
          <textarea required rows={3} value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} style={field} placeholder="What was this expense for?" />
        </div>

        <div className="form-row">
          <label>Activity type *</label>
          <select required value={form.activityTypeId} onChange={(e) => set({ activityTypeId: e.target.value })} style={field}>
            {/* Only one choice (already selected) -> no "Select..." placeholder. */}
            {!(form.activityTypeId && activityTypes.length + (activityTypes.some((o) => o.id === form.activityTypeId) ? 0 : 1) === 1) && (
              <option value="">Select...</option>
            )}
            {activityTypes.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
            {form.activityTypeId && !activityTypes.some((o) => o.id === form.activityTypeId) && (
              <option value={form.activityTypeId}>{existingActivityTypeName}</option>
            )}
          </select>
        </div>

        <div className="form-row">
          <label>Agency (can pick more than one)</label>
          <Chips items={selAgencies} onRemove={removeAgency} />
          <AddSelect placeholder="Add agency..." options={agencies.filter((a) => !selAgencies.some((s) => s.id === a.id))} onPick={addAgency} style={field} />
        </div>

        <div className="form-row">
          <label>Advertiser * (can pick more than one)</label>
          <Chips items={selAdvertisers} onRemove={removeAdvertiser} />
          <AddSelect placeholder="Add advertiser..." options={advertisers.filter((a) => !selAdvertisers.some((s) => s.id === a.id))} onPick={addAdvertiser} style={field} />
        </div>

        <div className="form-row">
          <label>Brand * (can pick more than one)</label>
          {selAdvertisers.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Pick an advertiser first</div>
          ) : brands.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No brands for the selected advertiser(s)</div>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
              {selAdvertisers.map((adv) => {
                const list = brands.filter((b) => b.advertiserId === adv.id);
                if (list.length === 0) return null;
                return (
                  <div key={adv.id}>
                    <div style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface-2)' }}>{adv.name}</div>
                    {list.map((b) => (
                      <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 12px', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={selBrands.some((s) => s.id === b.id)}
                          onChange={() => toggleBrand(b)}
                          style={{ width: 20, height: 20 }}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {selBrands.length > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{selBrands.length} selected</div>}
        </div>

        <ParticipantSection
          title="Agency Participant"
          companyLabel="Agency name"
          companies={selAgencies}
          rows={agencyParticipants}
          setRows={setAgencyParticipants}
          field={field}
        />
        <ParticipantSection
          title="Advertiser Participant"
          companyLabel="Advertiser name"
          companies={selAdvertisers}
          rows={advertiserParticipants}
          setRows={setAdvertiserParticipants}
          field={field}
        />
        <InternalParticipantSection units={units} rows={internalParticipants} setRows={setInternalParticipants} field={field} />

        <div className="form-row">
          <label>Merchant</label>
          <input value={form.merchantName} onChange={(e) => set({ merchantName: e.target.value })} style={field} placeholder="Restaurant / store name" />
        </div>

        <div className="form-row">
          <label>Location</label>
          {readOnly ? (
            <input value={form.location} readOnly style={{ ...field, flex: 1 }} placeholder="-" />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={form.location} readOnly style={{ ...field, flex: 1 }} placeholder={locating ? 'Detecting location...' : 'Detected from GPS'} />
                <button type="button" className="btn" style={{ minHeight: 44, minWidth: 48 }} disabled={locating} onClick={() => detectLocation(false)} aria-label="Use my location">
                  {locating ? '...' : '📍'}
                </button>
              </div>
              <div
                role="status"
                style={{
                  fontSize: 12,
                  margin: '6px 0',
                  color: locStatus.tone === 'error' ? 'var(--danger)' : locStatus.tone === 'ok' ? 'var(--success)' : 'var(--muted)',
                }}
              >
                {locStatus.text}
              </div>
              <LocationPicker value={form.location} />
            </>
          )}
        </div>

        <div className="form-row">
          <label>Payment method *</label>
          <select required value={form.paymentMethodId} onChange={(e) => set({ paymentMethodId: e.target.value, creditCardId: '' })} style={field}>
            <option value="">Select...</option>
            {paymentMethods.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        {paymentCode === 'CORPORATE_CARD' && (
          <div className="form-row">
            <label>Corporate card *</label>
            <select required value={form.creditCardId} onChange={(e) => set({ creditCardId: e.target.value })} style={field}>
              <option value="">Select...</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.bank} •••• {c.last4} ({c.user?.name ?? '-'})</option>
              ))}
            </select>
          </div>
        )}

        {paymentMethods.length > 0 && form.paymentMethodId && paymentCode !== 'CORPORATE_CARD' && (
          <div className="form-row">
            <label>Payment note</label>
            <input value={form.paymentMethodNote} onChange={(e) => set({ paymentMethodNote: e.target.value })} style={field} placeholder="(optional)" />
          </div>
        )}

      </div>
      </fieldset>

      {/* Sticky so Submit stays reachable on long forms; padding-bottom above
          keeps the last field clear of it. Anchored above the floating
          bottom-nav pill (mobile.css .bottom-nav: offset 10px + safe-area,
          ~66px tall) instead of flush to the viewport edge - both are
          position:fixed at the same z-index, so sitting at bottom:0 put this
          bar directly behind the nav and covered the Submit button. */}
      {!readOnly && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(76px + env(safe-area-inset-bottom))',
            padding: '10px 14px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            zIndex: 25,
          }}
        >
          <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', gap: 8 }}>
            {showDraftButton && (
              <button
                type="button"
                className="btn"
                disabled={saving || scanning}
                onClick={() => save(true)}
                style={{ flex: 1, minHeight: 48, fontSize: 16, justifyContent: 'center' }}
                title="Keep editing later - not sent to any approver yet"
              >
                {saving ? progress || 'Saving...' : 'Save as Draft'}
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving || scanning} style={{ flex: 1, minHeight: 48, fontSize: 16, justifyContent: 'center' }}>
              {saving ? progress || 'Saving...' : showDraftButton ? 'Submit expense' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
