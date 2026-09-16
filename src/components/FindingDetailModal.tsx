'use client';

import { useState } from 'react';
import Link from 'next/link';
import Modal from './Modal';
import { api, ApiError } from '@/lib/api';

export interface FindingRow {
  id: string;
  findingNo: string;
  findingType: string;
  findingLabel: string;
  status: string;
  riskLevel: string;
  amount: number;
  agingDays: number;
  departmentName: string;
  subjectNo: string;
  submitterName: string;
  expenseId: string | null;
  settlementId: string | null;
  notes: string | null;
}

const STATUS_OPTIONS = ['OPEN', 'FOLLOW_UP', 'INVESTIGATING', 'RESOLVED'];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ');
}

export default function FindingDetailModal({
  finding,
  onClose,
  onUpdated,
}: {
  finding: FindingRow;
  onClose: () => void;
  onUpdated: (updated: FindingRow) => void;
}) {
  const [status, setStatus] = useState(finding.status);
  const [notes, setNotes] = useState(finding.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = () => {
    setSaving(true);
    setError('');
    api
      .patch<{ id: string }>(`/audit-report/findings/${finding.id}`, { status, notes: notes || undefined })
      .then(() => {
        onUpdated({ ...finding, status, notes });
        onClose();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to update finding'))
      .finally(() => setSaving(false));
  };

  const subjectHref = finding.expenseId ? `/expenses/${finding.expenseId}` : finding.settlementId ? '/settlement' : null;

  return (
    <Modal title={finding.findingNo} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>Finding Type</div>
            <div style={{ fontWeight: 600 }}>{finding.findingLabel}</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>Risk Level</div>
            <div style={{ fontWeight: 600 }}>{statusLabel(finding.riskLevel)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>Amount</div>
            <div style={{ fontWeight: 600 }}>{formatCurrency(finding.amount)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>Aging</div>
            <div style={{ fontWeight: 600 }}>{finding.agingDays} days</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>POD</div>
            <div style={{ fontWeight: 600 }}>{finding.departmentName}</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>Submitter</div>
            <div style={{ fontWeight: 600 }}>{finding.submitterName}</div>
          </div>
        </div>

        {subjectHref && (
          <div>
            <Link href={subjectHref} className="btn">
              View {finding.expenseId ? 'Expense' : 'Settlement'} {finding.subjectNo}
            </Link>
          </div>
        )}

        <label style={{ fontSize: 12, fontWeight: 600 }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12, fontWeight: 600 }}>
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ display: 'block', width: '100%', marginTop: 4, resize: 'vertical' }}
          />
        </label>

        {error && <div className="error-text">{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
