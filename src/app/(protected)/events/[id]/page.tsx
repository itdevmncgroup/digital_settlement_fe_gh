'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/date';

interface EventDetail {
  id: string;
  eventNo: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  purpose: string;
  estimatedAmount: string;
  notes: string | null;
  status: string;
  rejectReason: string | null;
  salesId: string;
  sales: { name: string };
  unit: { name: string } | null;
  department: { name: string } | null;
  advertiser: { name: string };
  brand: { name: string };
  activityType: { name: string };
  participants: { id: string; name: string; position: string | null; company: string | null }[];
}

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
  documentStage: string;
  steps: ApprovalStep[];
  currentStep: number;
  status: string;
  actions: ApprovalAction[];
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Pre-Event detail: mirrors the Expense detail page's Approval Trail card, since
// Pre-Event approval now runs on the same multi-step Approval Level engine
// (previously a single-step Supervisor approve/reject with no trail at all).
export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasRole } = useAuth();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<EventDetail>(`/events/${id}`).then(setEvent).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    api.get<ApprovalDetail>(`/approvals/event/${id}`).then(setApproval).catch(() => setApproval(null));
  };

  useEffect(load, [id]);

  const isOwner = event?.salesId === user?.id;
  const currentStepInfo = approval && approval.status === 'PENDING' ? approval.steps.find((s) => s.stepOrder === approval.currentStep) : null;
  const canAct = !!currentStepInfo && (currentStepInfo.resolvedApprover?.id === user?.id || hasRole('ADMIN'));
  const canSubmit = !!event && event.status === 'DRAFT' && isOwner;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/events/${id}/submit`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/approvals/event/${id}/approve`);
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
    setError('');
    try {
      await api.post(`/approvals/event/${id}/reject`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !event) return <div className="error-text">{error}</div>;
  if (!event) return <div>Loading...</div>;

  return (
    <div>
      <div className="toolbar">
        <h1>{event.eventNo}</h1>
        <span className="badge badge-info">{event.status}</span>
      </div>

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <div className="form-grid">
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Sales</div>
            <div>{event.sales?.name}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Unit</div>
            <div>{event.unit?.name ?? '-'}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Department</div>
            <div>{event.department?.name ?? '-'}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Advertiser</div>
            <div>{event.advertiser?.name}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Brand</div>
            <div>{event.brand?.name}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Activity</div>
            <div>{event.activityType?.name}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Date</div>
            <div>{formatDate(event.date)}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Estimated Amount</div>
            <div>{formatCurrency(event.estimatedAmount)}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Location</div>
            <div>{event.location || '-'}</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12 }}>Purpose</div>
            <div>{event.purpose}</div>
          </div>
        </div>

        {event.rejectReason && (
          <div className="error-text" style={{ marginTop: 12 }}>Rejected: {event.rejectReason}</div>
        )}

        {event.participants.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="label" style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>Participants</div>
            {event.participants.map((p) => (
              <div key={p.id} style={{ fontSize: 13, padding: '2px 0' }}>
                {p.name}
                {p.position ? ` — ${p.position}` : ''}
                {p.company ? ` (${p.company})` : ''}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          {canSubmit && (
            <button className="btn btn-primary" disabled={busy} onClick={submit}>
              Submit for Approval
            </button>
          )}
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
    </div>
  );
}
