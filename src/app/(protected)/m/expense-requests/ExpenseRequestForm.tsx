'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import NumberInput from '@/components/NumberInput';
import ClientPartiesPicker, { ClientParties, EMPTY_PARTIES } from '@/components/ClientPartiesPicker';
import { useAuth } from '@/lib/auth';
import { ExpenseRequest } from '@/lib/expenseRequests';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// New / edit Expense Request (Flower Bouquet), entered by Sales Admin. Locked to
// the "Flower Bouquet" Activity Type (the only one the BE currently accepts for
// this flow - see ALLOWED_ACTIVITY_TYPE_NAMES in expense-requests.service.ts).
// "Save Draft" keeps it editable (status DRAFT, no approval chain yet);
// "Submit" sends it into the Head Dept -> Co-CSO approval chain. Passing
// `request` (a DRAFT) edits it via PATCH instead of creating a new one.

interface Option {
  id: string;
  name: string;
}

const field: React.CSSProperties = { width: '100%', fontSize: 16, minHeight: 44, boxSizing: 'border-box' };

interface Requestor {
  id: string;
  name: string;
  employeeId: string;
  departmentIds: string[];
}

// A holder of webmobile.request.expense.create.owndept (or an Admin) can pick another user as the
// requestor on a new Request; the Department then follows the requestor.
export default function ExpenseRequestForm({ request }: { request?: ExpenseRequest }) {
  const router = useRouter();
  const toast = useToast();
  const { user, hasRole, hasPermission } = useAuth();
  const isAdmin = hasRole('ADMINISTRATOR');
  const canPickRequestor = !request && (isAdmin || hasPermission('webmobile.request.expense.create.owndept'));
  const [requestors, setRequestors] = useState<Requestor[]>([]);
  const [requestorId, setRequestorId] = useState('');
  const [myDepartments, setMyDepartments] = useState<Option[]>([]);

  const [activityTypes, setActivityTypes] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [activityTypeId, setActivityTypeId] = useState(request?.activityType.id ?? '');
  const [departmentId, setDepartmentId] = useState(request?.department?.id ?? '');
  const [parties, setParties] = useState<ClientParties>(
    request
      ? {
          agencies: request.agencies.map((a) => a.agency),
          advertisers: request.advertisers.map((a) => a.advertiser),
          brands: request.brands.map((b) => b.brand),
        }
      : EMPTY_PARTIES,
  );
  const [budget, setBudget] = useState(request?.requestBudget ? String(Math.round(Number(request.requestBudget))) : '');
  const [greetingText, setGreetingText] = useState(request?.greetingText ?? '');
  const [sendDate, setSendDate] = useState(request?.sendDate ? request.sendDate.slice(0, 10) : todayIso());
  const [recipient, setRecipient] = useState(request?.recipient ?? '');
  const [recipientAddress, setRecipientAddress] = useState(request?.recipientAddress ?? '');
  const [logo, setLogo] = useState(request?.logo ?? '');
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);

  useEffect(() => {
    api
      .get<Option[]>('/activity-types?active=true')
      .then((all) => {
        const karanganBunga = all.filter((a) => a.name === 'Flower Bouquet');
        setActivityTypes(karanganBunga);
        if (karanganBunga.length === 1) setActivityTypeId(karanganBunga[0].id);
      })
      .catch(() => undefined);
    api
      .get<Option[]>('/departments/me')
      .then((d) => {
        setMyDepartments(d);
        setDepartments(d);
        if (d.length === 1) setDepartmentId(d[0].id);
      })
      .catch(() => undefined);
    if (canPickRequestor) {
      api.get<Requestor[]>('/expense-requests/requestors').then(setRequestors).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Department follows the requestor: their own Departments, limited (unless Admin) to the
  // caller's. Back to the caller's own list when "Myself" is picked again.
  const pickRequestor = async (id: string) => {
    setRequestorId(id);
    if (!id) {
      setDepartments(myDepartments);
      setDepartmentId(myDepartments.length === 1 ? myDepartments[0].id : '');
      return;
    }
    try {
      const theirs = await api.get<Option[]>(`/departments?salesId=${id}&active=true`);
      const mine = new Set(myDepartments.map((d) => d.id));
      const list = isAdmin ? theirs : theirs.filter((d) => mine.has(d.id));
      setDepartments(list);
      setDepartmentId(list.length === 1 ? list[0].id : '');
    } catch {
      setDepartments([]);
      setDepartmentId('');
    }
  };

  const save = async (asDraft: boolean) => {
    if (!activityTypeId) return toast.warning('Select an Activity Type');
    if (parties.agencies.length === 0 && parties.advertisers.length === 0) return toast.warning('Select at least one Agency or Advertiser');
    if (budget && !(Number(budget) > 0)) return toast.warning('Budget must be greater than 0');
    if (!greetingText.trim()) return toast.warning('Enter the Greeting Text');
    if (!sendDate) return toast.warning('Select the Send Date');
    if (!recipientAddress.trim()) return toast.warning('Enter the Recipient Address');
    if (requestorId && departments.length === 0) return toast.warning('This requestor shares no Department with you');
    if (departments.length > 1 && !departmentId) return toast.warning('Select a Department');

    const body = {
      activityTypeId,
      agencyIds: parties.agencies.length ? parties.agencies.map((a) => a.id) : undefined,
      advertiserIds: parties.advertisers.length ? parties.advertisers.map((a) => a.id) : undefined,
      brandIds: parties.brands.length ? parties.brands.map((b) => b.id) : undefined,
      budget: Number(budget) > 0 ? Number(budget) : undefined,
      greetingText: greetingText.trim(),
      sendDate,
      recipient: recipient.trim() || undefined,
      recipientAddress: recipientAddress.trim(),
      logo: logo.trim() || undefined,
      departmentId: departmentId || undefined,
      requestedById: requestorId || undefined,
    };

    setSaving(asDraft ? 'draft' : 'submit');
    try {
      let id = request?.id;
      if (id) {
        await api.patch(`/expense-requests/${id}`, body);
        if (!asDraft) await api.post(`/expense-requests/${id}/submit`);
      } else {
        id = (await api.post<{ id: string }>('/expense-requests', { ...body, saveAsDraft: asDraft })).id;
      }
      toast.success(asDraft ? 'Draft saved' : 'Expense Request submitted');
      router.replace('/m/expense-requests');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : asDraft ? 'Failed to save draft' : 'Failed to submit request');
    } finally {
      setSaving(null);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      style={{ paddingBottom: 96 }}
    >
      <h1>{request ? `Edit ${request.requestNo}` : 'New Request Expense'}</h1>

      <div className="card">
        <div className="form-row">
          <label>Activity Type *</label>
          <select required disabled={activityTypes.length <= 1} value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} style={field}>
            <option value="">Select...</option>
            {activityTypes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        {canPickRequestor && (
          <div className="form-row">
            <label>Requestor</label>
            <select value={requestorId} onChange={(e) => pickRequestor(e.target.value)} style={field}>
              <option value="">{`Myself (${user?.name ?? ''})`}</option>
              {requestors
                .filter((r) => r.id !== user?.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.employeeId})
                  </option>
                ))}
            </select>
          </div>
        )}

        <ClientPartiesPicker value={parties} onChange={setParties} style={field} />

        <div className="form-row">
          <label>Budget (IDR)</label>
          <NumberInput inputMode="numeric" value={budget} onChange={setBudget} style={field} placeholder="0" />
        </div>

        <div className="form-row">
          <label>Isi Ucapan *</label>
          <textarea required rows={3} value={greetingText} onChange={(e) => setGreetingText(e.target.value)} style={field} placeholder="Greeting text" />
        </div>

        <div className="form-row">
          <label>Tanggal Kirim *</label>
          <input type="date" required value={sendDate} onChange={(e) => setSendDate(e.target.value)} style={field} />
        </div>

        <div className="form-row">
          <label>Recipient</label>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} style={field} placeholder="(optional)" />
        </div>

        <div className="form-row">
          <label>Alamat Penerima *</label>
          <textarea required rows={2} value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)} style={field} placeholder="Recipient address" />
        </div>

        <div className="form-row">
          <label>Logo</label>
          <input value={logo} onChange={(e) => setLogo(e.target.value)} style={field} placeholder="(optional)" />
        </div>

        {(departments.length > 1 || (!!requestorId && departments.length === 0)) && (
          <div className="form-row">
            <label>Department *</label>
            <select required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={field}>
              <option value="">Select...</option>
              {departments.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

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
          <button type="button" className="btn" disabled={!!saving} onClick={() => save(true)} style={{ flex: 1, minHeight: 48, fontSize: 16, justifyContent: 'center' }}>
            {saving === 'draft' ? 'Saving...' : 'Save Draft'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!!saving} style={{ flex: 1, minHeight: 48, fontSize: 16, justifyContent: 'center' }}>
            {saving === 'submit' ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </form>
  );
}
