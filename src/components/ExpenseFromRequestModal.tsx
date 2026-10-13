'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { ExpenseRequest, clientLabel } from '@/lib/expenseRequests';
import Modal from '@/components/Modal';
import NumberInput from '@/components/NumberInput';

type RequestRow = ExpenseRequest & { expense: { id: string; expenseNo: string } | null };

// Corsec raises an Expense from a PROCEED Expense Request. Date, Agency,
// Advertiser, Brand and Activity Type come from the Request (read-only here, the
// backend takes them from the Request anyway). The Expense is saved as
// PENDING_SALES_ADMIN and handed to a Sales Admin of the Request's Department,
// who completes it and submits it into the approval chain.
export default function ExpenseFromRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestId, setRequestId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<RequestRow[]>('/expense-requests')
      // Only a PROCEED Request that has not been turned into an Expense yet.
      .then((rows) => setRequests(rows.filter((r) => r.status === 'PROCEED' && !r.expense)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load Expense Requests'))
      .finally(() => setLoading(false));
  }, []);

  const selected = requests.find((r) => r.id === requestId) ?? null;

  const pick = (id: string) => {
    setRequestId(id);
    const r = requests.find((x) => x.id === id);
    setPurpose(r ? `${r.activityType.name} - ${r.greetingText}` : '');
    setAmount(r ? String(r.budgetAmount ?? r.requestBudget ?? '') : '');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/expenses', {
        expenseRequestId: selected.id,
        expenseDate: selected.sendDate,
        purpose,
        amount: Number(amount) || 0,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const names = <T,>(items: T[], label: (item: T) => string) => (items.length ? items.map(label).join(', ') : '-');

  return (
    <Modal title="New Expense from Expense Request" onClose={onClose}>
      <form onSubmit={onSubmit}>
        {error && <div className="error-text">{error}</div>}
        <div className="form-row">
          <label>Expense Request *</label>
          <select required value={requestId} onChange={(e) => pick(e.target.value)} disabled={loading}>
            <option value="">{loading ? 'Loading...' : requests.length ? 'Select a proceeded request' : 'No proceeded request available'}</option>
            {requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.requestNo} - {clientLabel(r)} ({formatDate(r.sendDate)})
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="form-row">
                <label>Tanggal Kirim (Expense Date)</label>
                <input readOnly value={formatDate(selected.sendDate)} />
              </div>
              <div className="form-row">
                <label>Activity Type</label>
                <input readOnly value={selected.activityType.name} />
              </div>
              <div className="form-row">
                <label>Agency</label>
                <input readOnly value={names(selected.agencies, (a) => a.agency.name)} />
              </div>
              <div className="form-row">
                <label>Advertiser</label>
                <input readOnly value={names(selected.advertisers, (a) => a.advertiser.name)} />
              </div>
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <label>Brand</label>
                <input readOnly value={names(selected.brands, (b) => b.brand.name)} />
              </div>
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <label>Purpose *</label>
                <input required value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Amount (IDR)</label>
                <NumberInput allowDecimals value={amount} onChange={setAmount} />
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Saved as <b>PENDING_SALES_ADMIN</b>: a Sales Admin of {selected.department?.name ?? 'the request department'} completes the details and submits it for approval.
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !selected}>
            {saving ? 'Saving...' : 'Submit'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
