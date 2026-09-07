'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

interface TokenInfo {
  positionName: string;
  approverName: string;
  documentStage: 'PRE_EVENT' | 'EXPENSES' | 'SETTLEMENT';
  docNo: string;
  salesName: string;
  purpose: string;
}

// Public, unauthenticated landing page linked from the Reject button in an
// approval email - the token itself (single-use, expiring) is the credential,
// no login required. A reject reason can't be captured from a bare email
// link, so this is where that reason gets collected; Approve is one-click
// straight from the email and never routes through this page.
export default function EmailActionPage() {
  const { token } = useParams<{ token: string }>();

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'approved' | 'rejected' | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/public/approvals/${token}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'This link is invalid or has expired.');
        setInfo(body);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const submitReject = async () => {
    if (reason.trim().length < 3) {
      setError('Please enter a reason (at least 3 characters).');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/public/approvals/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Reject failed');
      setResult('rejected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card" style={{ width: 440 }}>
        <h2 style={{ marginTop: 0 }}>Approval Request</h2>

        {loading && <p style={{ color: 'var(--muted)' }}>Loading...</p>}

        {!loading && result === 'rejected' && (
          <p style={{ color: 'var(--danger)' }}>The request has been rejected. You can close this page now.</p>
        )}

        {!loading && !result && error && !info && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {!loading && !result && info && (
          <>
            <p style={{ color: 'var(--muted)', marginTop: -8 }}>
              As <strong>{info.positionName}</strong>, this {info.documentStage === 'PRE_EVENT' ? 'Pre-Event' : info.documentStage === 'EXPENSES' ? 'Expenses' : 'Settlement'} request needs
              your decision.
            </p>
            <table style={{ marginBottom: 16 }}>
              <tbody>
                <tr><td style={{ color: 'var(--muted)', border: 'none' }}>Document No</td><td style={{ border: 'none' }}><strong>{info.docNo}</strong></td></tr>
                <tr><td style={{ color: 'var(--muted)', border: 'none' }}>Sales</td><td style={{ border: 'none' }}>{info.salesName}</td></tr>
                <tr><td style={{ color: 'var(--muted)', border: 'none' }}>Purpose</td><td style={{ border: 'none' }}>{info.purpose}</td></tr>
              </tbody>
            </table>

            <a href={`${API_URL}/public/approvals/${token}/approve`} className="btn btn-success" style={{ marginBottom: 16, justifyContent: 'center' }}>
              Approve
            </a>

            <label>Reject reason</label>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being rejected?" />
            {error && <div className="error-text">{error}</div>}
            <button className="btn btn-danger" disabled={submitting} onClick={submitReject} style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>
              {submitting ? 'Submitting...' : 'Reject'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
