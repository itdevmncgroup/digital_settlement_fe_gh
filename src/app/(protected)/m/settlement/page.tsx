'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import WebMobileGate from '@/components/WebMobileGate';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { formatCurrency, SkeletonList, StatusBadge, statusTone, TONE_COLOR, toneStyle } from '@/lib/mobileUi';

interface SettlementExpense {
  id: string;
  expenseNo: string;
  amount: string;
  status: string;
  sales: { name: string };
}

interface SettlementRow {
  id: string;
  settlementNo: string;
  totalAmount: string;
  status: 'DRAFT' | 'COMPLETE';
  createdAt: string;
  department: { name: string };
  createdBy: { name: string };
  expenses: SettlementExpense[];
  approvalRequest: {
    status: string;
    currentStep: number;
    steps: { stepOrder: number; position: { name: string }; resolvedApprover?: { name: string } }[];
  } | null;
}

export default function MobileSettlementPage() {
  return (
    <WebMobileGate permissions={['webmobile.settlement.read.owndept']}>
      <MobileSettlementList />
    </WebMobileGate>
  );
}

function MobileSettlementList() {
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState('');

  useEffect(() => {
    api
      .get<SettlementRow[]>('/settlements')
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (r) => !q || [r.settlementNo, r.department?.name, r.createdBy?.name].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <div>
      <h1>Settlement</h1>
      <div className="m-filters">
        <div className="m-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settlement no, department..."
          />
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {!rows && !error && <SkeletonList />}
      {rows && shown.length === 0 && <div className="m-empty">No settlements found.</div>}

      {shown.map((r) => {
        const ar = r.approvalRequest;
        const step = ar?.steps.find((s) => s.stepOrder === ar.currentStep);
        const open = openId === r.id;
        return (
          <div key={r.id} className="m-item" style={toneStyle(TONE_COLOR[statusTone(r.status)])}>
            <button
              type="button"
              onClick={() => setOpenId(open ? '' : r.id)}
              style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
              aria-expanded={open}
            >
              <div className="m-item-row">
                <span className="m-item-title">{r.settlementNo}</span>
                <span className="m-item-amount">{formatCurrency(r.totalAmount)}</span>
              </div>
              <div className="m-item-meta">
                {r.department?.name} · {r.createdBy?.name} · {formatDate(r.createdAt)}
              </div>
              <div className="m-item-foot">
                <StatusBadge status={r.status} />
                {ar && ar.status !== 'APPROVED' && step && (
                  <span>
                    Step {ar.currentStep + 1}/{ar.steps.length}: {step.position.name}
                    {step.resolvedApprover ? ` (${step.resolvedApprover.name})` : ''}
                  </span>
                )}
                <span style={{ marginLeft: 'auto' }}>
                  {r.expenses.length} expense(s) {open ? '▴' : '▾'}
                </span>
              </div>
            </button>
            {open &&
              r.expenses.map((e) => (
                <Link
                  key={e.id}
                  href={`/m/expenses/${e.id}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '10px 0',
                    marginTop: 4,
                    borderTop: '1px solid var(--border-soft)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{e.expenseNo}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.sales?.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{formatCurrency(e.amount)}</div>
                    <StatusBadge status={e.status} />
                  </div>
                </Link>
              ))}
          </div>
        );
      })}
    </div>
  );
}
