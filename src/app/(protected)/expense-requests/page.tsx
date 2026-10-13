'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError, uploadFiles } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import DatePicker from '@/components/DatePicker';
import Modal from '@/components/Modal';
import FileOrCameraInput from '@/components/FileOrCameraInput';
import LocalFileThumb from '@/components/LocalFileThumb';
import NumberInput from '@/components/NumberInput';
import ClientPartiesPicker, { ClientParties, EMPTY_PARTIES } from '@/components/ClientPartiesPicker';
import { clientLabel } from '@/lib/expenseRequests';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';
import { usePrompt } from '@/components/PromptDialog';
import { usePagination } from '@/lib/usePagination';

interface ApprovalStep {
  stepOrder: number;
  status: string;
  position: { name: string };
  resolvedApprover: { id: string; name: string };
}

type ExpenseRequestStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'BUDGET_INPUT' | 'CORSEC_VERIFICATION' | 'PROCEED' | 'REJECTED' | 'CANCELLED';

interface ExpenseRequestRow {
  id: string;
  requestNo: string;
  requestedBy: { id: string; name: string };
  department: { id: string; name: string } | null;
  activityType: Option;
  clientName: string | null;
  agencies: { agency: Option }[];
  advertisers: { advertiser: Option }[];
  brands: { brand: Option }[];
  requestBudget: string | null;
  greetingText: string;
  sendDate: string;
  recipientAddress: string;
  status: ExpenseRequestStatus;
  rejectReason: string | null;
  budgetAmount: string | null;
  budgetNotes: string | null;
  budgetBy: { name: string } | null;
  verifiedBy: { name: string } | null;
  expense: { id: string; expenseNo: string; status: string } | null;
  approvalRequest: { currentStep: number; status: string; steps: ApprovalStep[] } | null;
}

interface Option {
  id: string;
  name: string;
}

// Activity Type is locked to a single choice for now; more names can be appended here
// (the API enforces the same allow-list).
const ALLOWED_ACTIVITY_TYPES = ['Karangan Bunga'];

// The Sales Admin sent the Request's Expense back: Corsec updates its invoice (see POST/PATCH
// /expenses/from-request/:id) instead of adding one.
const isRevision = (r: ExpenseRequestRow) => r.expense?.status === 'REVISION';
const DEFAULT_MERCHANT = 'KELOPAQ';

// Position codes of the two post-approval teams (see BE seed).
const POSITION_SALES_CS = 'SLS-CS';
const POSITION_CORSEC = 'CORSEC';

const EMPTY_FORM = {
  activityTypeId: '',
  budget: '',
  greetingText: '',
  sendDate: '',
  recipientAddress: '',
  departmentId: '',
};

const STATUS_LABEL: Record<ExpenseRequestStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  BUDGET_INPUT: 'Waiting Budget',
  CORSEC_VERIFICATION: 'Corsec Verification',
  PROCEED: 'Proceed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

function StatusBadge({ status }: { status: ExpenseRequestStatus }) {
  const cls = status === 'PROCEED' ? 'badge-success' : status === 'REJECTED' || status === 'CANCELLED' ? 'badge-danger' : status === 'DRAFT' ? 'badge-info' : 'badge-warning';
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status]}</span>;
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Expense Request (Karangan Bunga), entered by Sales Admin. Head Dept -> Co-CSO
// approve, then Sales Customer Service fills the budget, then Corsec verifies.
export default function ExpenseRequestsPage() {
  const { user, hasRole, hasPermission } = useAuth();
  const prompt = usePrompt();
  const isAdmin = hasRole('ADMINISTRATOR');
  const canCreate = hasRole('SALES_ADMIN') || isAdmin || hasPermission('request.expense.create.owndept');
  const canFillBudget = user?.position?.code === POSITION_SALES_CS || isAdmin;
  const canVerify = user?.position?.code === POSITION_CORSEC || isAdmin;

  const [rows, setRows] = useState<ExpenseRequestRow[]>([]);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [parties, setParties] = useState<ClientParties>(EMPTY_PARTIES);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [activityTypes, setActivityTypes] = useState<Option[]>([]);

  const [budgetFor, setBudgetFor] = useState<ExpenseRequestRow | null>(null);
  const [budgetForm, setBudgetForm] = useState({ amount: '', notes: '' });
  const [budgetError, setBudgetError] = useState('');

  // "Add Invoices" popup: invoice files are uploaded together with the Expense they create.
  const [invoiceFor, setInvoiceFor] = useState<ExpenseRequestRow | null>(null);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [productPhotos, setProductPhotos] = useState<File[]>([]);
  const [invoiceMerchant, setInvoiceMerchant] = useState(DEFAULT_MERCHANT);
  const [invoiceError, setInvoiceError] = useState('');

  // Cancel popup (Corsec): reason is required.
  const [cancelFor, setCancelFor] = useState<ExpenseRequestRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');

  const load = () => {
    api
      .get<ExpenseRequestRow[]>('/expense-requests')
      .then((data) => {
        setRows(data);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!canCreate) return;
    api.get<Option[]>('/departments/me').then(setDepartments).catch(() => undefined);
    api
      .get<Option[]>('/activity-types?active=true')
      .then((all) => {
        const allowed = all.filter((a) => ALLOWED_ACTIVITY_TYPES.includes(a.name));
        setActivityTypes(allowed);
        // Single choice: preselect it so the form doesn't open with a blank required field.
        if (allowed.length === 1) setForm((f) => (f.activityTypeId ? f : { ...f, activityTypeId: allowed[0].id }));
      })
      .catch(() => undefined);
  }, [canCreate]);

  // Only asked when the requester has no single unambiguous Department.
  const needsDepartment = departments.length !== 1;

  // Client-side filter: the list is already scoped by the API, no server-side search needed.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.requestNo, r.requestedBy?.name, r.department?.name, r.activityType?.name, clientLabel(r), r.brands?.map((b) => b.brand.name).join(' '), r.greetingText, r.recipientAddress, STATUS_LABEL[r.status]]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const pagination = usePagination(filtered);

  // The only actionable approval step is the current one (approval is strictly sequential).
  const currentStepOf = (r: ExpenseRequestRow) => {
    const ar = r.approvalRequest;
    if (r.status !== 'PENDING_APPROVAL' || !ar || ar.status !== 'PENDING') return null;
    return ar.steps.find((s) => s.stepOrder === ar.currentStep) ?? null;
  };
  const canActOnApproval = (r: ExpenseRequestRow) => {
    const step = currentStepOf(r);
    return !!step && (step.resolvedApprover?.id === user?.id || isAdmin);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError('');
    setForm({ ...EMPTY_FORM, activityTypeId: activityTypes.length === 1 ? activityTypes[0].id : '' });
    setParties(EMPTY_PARTIES);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (parties.agencies.length === 0 && parties.advertisers.length === 0) return setFormError('Select at least one Agency or Advertiser');
    setSaving(true);
    setFormError('');
    try {
      await api.post('/expense-requests', {
        activityTypeId: form.activityTypeId,
        agencyIds: parties.agencies.length ? parties.agencies.map((a) => a.id) : undefined,
        advertiserIds: parties.advertisers.length ? parties.advertisers.map((a) => a.id) : undefined,
        brandIds: parties.brands.length ? parties.brands.map((b) => b.id) : undefined,
        budget: Number(form.budget) > 0 ? Number(form.budget) : undefined,
        greetingText: form.greetingText.trim(),
        sendDate: form.sendDate,
        recipientAddress: form.recipientAddress.trim(),
        departmentId: form.departmentId || undefined,
      });
      closeForm();
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Runs one row action, reloading the list after; errors land in the page banner.
  const runAction = async (id: string, fn: () => Promise<unknown>, failMessage: string) => {
    setBusyId(id);
    setError('');
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failMessage);
    } finally {
      setBusyId(null);
    }
  };

  const approve = (r: ExpenseRequestRow) =>
    runAction(r.id, () => api.post(`/approvals/expense-request/${r.id}/approve`), 'Approve failed');

  const reject = async (r: ExpenseRequestRow) => {
    const reason = await prompt({ title: 'Reject reason', danger: true });
    if (!reason) return;
    await runAction(r.id, () => api.post(`/approvals/expense-request/${r.id}/reject`, { reason }), 'Reject failed');
  };

  const proceed = (r: ExpenseRequestRow) =>
    runAction(r.id, () => api.post(`/expense-requests/${r.id}/verify`, { decision: 'PROCEED' }), 'Proceed failed');

  const openCancel = (r: ExpenseRequestRow) => {
    setCancelFor(r);
    setCancelReason('');
    setCancelError('');
  };

  const onSubmitCancel = async (e: FormEvent) => {
    e.preventDefault();
    if (!cancelFor) return;
    setSaving(true);
    setCancelError('');
    try {
      await api.post(`/expense-requests/${cancelFor.id}/verify`, { decision: 'CANCELLED', reason: cancelReason.trim() });
      setCancelFor(null);
      load();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : 'Cancel failed');
    } finally {
      setSaving(false);
    }
  };

  const openInvoices = (r: ExpenseRequestRow) => {
    setInvoiceFor(r);
    setInvoiceFiles([]);
    setProductPhotos([]);
    setInvoiceMerchant(DEFAULT_MERCHANT);
    setInvoiceError('');
  };

  // Creates the Expense from this Request (BE copies its data) with the uploaded files as its Invoice.
  // Once the Sales Admin sent that Expense back (REVISION) the same popup replaces its invoice
  // files instead, which returns the Expense to the Sales Admin.
  const onUploadAndCreate = async () => {
    if (!invoiceFor || invoiceFiles.length === 0) return;
    setSaving(true);
    setInvoiceError('');
    try {
      await uploadFiles(`/expenses/from-request/${invoiceFor.id}`, invoiceFiles, 'files', {
        files: { photos: productPhotos },
        fields: { merchantName: invoiceMerchant.trim() },
        method: isRevision(invoiceFor) ? 'PATCH' : 'POST',
      });
      setInvoiceFor(null);
      load();
    } catch (err) {
      setInvoiceError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const openBudget = (r: ExpenseRequestRow) => {
    setBudgetFor(r);
    setBudgetForm({ amount: '', notes: '' });
    setBudgetError('');
  };

  const onSubmitBudget = async (e: FormEvent) => {
    e.preventDefault();
    if (!budgetFor) return;
    setSaving(true);
    setBudgetError('');
    try {
      await api.post(`/expense-requests/${budgetFor.id}/budget`, {
        budgetAmount: Number(budgetForm.amount),
        budgetNotes: budgetForm.notes.trim() || undefined,
      });
      setBudgetFor(null);
      load();
    } catch (err) {
      setBudgetError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Expense Request</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search client, greeting, address..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              Create Request
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Request No</th>
              <th>Requested By</th>
              <th>Activity Type</th>
              <th>Client</th>
              <th>Greeting</th>
              <th>Send Date</th>
              <th>Recipient Address</th>
              <th>Budget</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((r) => {
              const step = currentStepOf(r);
              return (
                <tr key={r.id}>
                  <td>{r.requestNo}</td>
                  <td>
                    {r.requestedBy?.name}
                    {r.department && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.department.name}</div>}
                  </td>
                  <td>{r.activityType?.name}</td>
                  <td>{clientLabel(r)}</td>
                  <td>{r.greetingText}</td>
                  <td>{formatDate(r.sendDate)}</td>
                  <td>{r.recipientAddress}</td>
                  <td>
                    {r.budgetAmount ? formatCurrency(r.budgetAmount) : '-'}
                    {r.budgetBy && <div style={{ fontSize: 11, color: 'var(--muted)' }}>by {r.budgetBy.name}</div>}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                    {step && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        Waiting: {step.position.name} ({step.resolvedApprover?.name})
                      </div>
                    )}
                    {r.status === 'PROCEED' && r.verifiedBy && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Proceeded by {r.verifiedBy.name}</div>
                    )}
                    {r.expense && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Expense {r.expense.expenseNo}</div>}
                    {r.rejectReason && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>{r.rejectReason}</div>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {canActOnApproval(r) && (
                        <>
                          <button className="btn btn-approve" disabled={busyId === r.id} onClick={() => approve(r)}>
                            Approve ({step?.position.name})
                          </button>
                          <button className="btn btn-reject" disabled={busyId === r.id} onClick={() => reject(r)}>
                            Reject
                          </button>
                        </>
                      )}
                      {r.status === 'BUDGET_INPUT' && canFillBudget && (
                        <button className="btn btn-primary" disabled={busyId === r.id} onClick={() => openBudget(r)}>
                          Input Budget
                        </button>
                      )}
                      {r.status === 'CORSEC_VERIFICATION' && canVerify && (
                        <>
                          <button className="btn btn-approve" disabled={busyId === r.id} onClick={() => proceed(r)}>
                            Proceed
                          </button>
                          <button className="btn btn-reject" disabled={busyId === r.id} onClick={() => openCancel(r)}>
                            Cancel
                          </button>
                        </>
                      )}
                      {r.status === 'PROCEED' && canVerify && (!r.expense || isRevision(r)) && (
                        <button className="btn btn-primary" disabled={busyId === r.id} onClick={() => openInvoices(r)}>
                          {isRevision(r) ? 'Update Invoice' : 'Add Invoices'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ color: 'var(--muted)' }}>
                  No requests
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > 0 && (
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

      {showForm && (
        <Modal title="Create Expense Request" onClose={closeForm}>
          <form onSubmit={onSubmit}>
            <div className="form-row">
              <label>Activity Type *</label>
              <select required value={form.activityTypeId} onChange={(e) => setForm({ ...form, activityTypeId: e.target.value })}>
                {activityTypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {needsDepartment && (
              <div className="form-row">
                <label>Department * (determines Head Dept approver)</label>
                <select required value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ClientPartiesPicker value={parties} onChange={setParties} style={{ width: '100%' }} />
            <div className="form-row">
              <label>Budget (IDR)</label>
              <NumberInput inputMode="numeric" value={form.budget} onChange={(v) => setForm({ ...form, budget: v })} placeholder="0" />
            </div>
            <div className="form-row">
              <label>Isi Ucapan *</label>
              <textarea required rows={4} value={form.greetingText} onChange={(e) => setForm({ ...form, greetingText: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Tanggal Kirim *</label>
              <DatePicker required value={form.sendDate} onChange={(v) => setForm({ ...form, sendDate: v })} />
            </div>
            <div className="form-row">
              <label>Alamat Penerima *</label>
              <textarea
                required
                rows={3}
                value={form.recipientAddress}
                onChange={(e) => setForm({ ...form, recipientAddress: e.target.value })}
              />
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn" onClick={closeForm}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={saving || !form.sendDate}>
                {saving ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {cancelFor && (
        <Modal title={`Cancel - ${cancelFor.requestNo}`} onClose={() => setCancelFor(null)}>
          <form onSubmit={onSubmitCancel}>
            <div className="form-row">
              <label>Cancel reason *</label>
              <textarea required rows={3} autoFocus value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            {cancelError && <div className="error-text">{cancelError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setCancelFor(null)}>
                Close
              </button>
              <button className="btn btn-reject" type="submit" disabled={saving || !cancelReason.trim()}>
                {saving ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {invoiceFor && (
        <Modal
          title={`${isRevision(invoiceFor) ? 'Update Invoice' : 'Add Invoices'} - ${invoiceFor.requestNo}`}
          onClose={() => !saving && setInvoiceFor(null)}
        >
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>
            {isRevision(invoiceFor)
              ? `Expense ${invoiceFor.expense?.expenseNo} was sent back by the Sales Admin. Upload the corrected invoice file(s); they replace the current ones and the Expense returns to the Sales Admin.`
              : `Upload the invoice file(s). An Expense is created automatically from this request (${invoiceFor.activityType?.name} for ${clientLabel(invoiceFor)}, sent ${formatDate(invoiceFor.sendDate)}).`}
          </p>
          <div className="form-row">
            <label>Invoice * (image/pdf, bisa lebih dari 1)</label>
            <FileOrCameraInput
              accept="image/jpeg,image/png,image/webp,application/pdf"
              cameraTitle="Scan Invoice"
              disabled={saving}
              onFiles={(files) => setInvoiceFiles((prev) => [...prev, ...files])}
            />
            {invoiceFiles.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {invoiceFiles.map((f, i) => (
                  <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setInvoiceFiles((prev) => prev.filter((_, idx) => idx !== i))} />
                ))}
              </div>
            )}
          </div>
          <div className="form-row">
            <label>Foto Product (image, bisa lebih dari 1)</label>
            <FileOrCameraInput
              accept="image/jpeg,image/png,image/webp"
              cameraTitle="Foto Product"
              disabled={saving}
              onFiles={(files) => setProductPhotos((prev) => [...prev, ...files])}
            />
            {productPhotos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {productPhotos.map((f, i) => (
                  <LocalFileThumb key={`${f.name}-${i}`} file={f} onRemove={() => setProductPhotos((prev) => prev.filter((_, idx) => idx !== i))} />
                ))}
              </div>
            )}
          </div>
          <div className="form-row">
            <label>Vendor</label>
            <input value={invoiceMerchant} disabled={saving} onChange={(e) => setInvoiceMerchant(e.target.value)} />
          </div>
          {invoiceError && <div className="error-text">{invoiceError}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn" disabled={saving} onClick={() => setInvoiceFor(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving || invoiceFiles.length === 0} onClick={onUploadAndCreate}>
              {saving ? 'Uploading...' : isRevision(invoiceFor) ? 'Upload & Update Invoice' : 'Upload & Create Expense'}
            </button>
          </div>
        </Modal>
      )}

      {budgetFor && (
        <Modal title={`Input Budget - ${budgetFor.requestNo}`} onClose={() => setBudgetFor(null)}>
          <form onSubmit={onSubmitBudget}>
            <p style={{ marginTop: 0, color: 'var(--muted)' }}>
              {budgetFor.activityType?.name} for {clientLabel(budgetFor)}, sent {formatDate(budgetFor.sendDate)}.
            </p>
            <div className="form-row">
              <label>Budget (IDR) *</label>
              <NumberInput required value={budgetForm.amount} onChange={(v) => setBudgetForm({ ...budgetForm, amount: v })} />
            </div>
            <div className="form-row">
              <label>Notes (optional)</label>
              <textarea rows={3} value={budgetForm.notes} onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })} />
            </div>
            {budgetError && <div className="error-text">{budgetError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setBudgetFor(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={saving || !Number(budgetForm.amount)}>
                {saving ? 'Saving...' : 'Submit to Corsec'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
