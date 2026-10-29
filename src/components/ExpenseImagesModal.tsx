'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import FileThumb from '@/components/FileThumb';
import Modal from '@/components/Modal';

interface ExpenseImages {
  expenseNo: string;
  amount: string;
  photos: { id: string; fileName: string; mimeType: string }[];
  invoices: {
    id: string;
    invoiceNumber: string | null;
    finalTotal: string | null;
    files: { id: string; fileName: string; mimeType: string }[];
  }[];
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Amounts keyed in for the Expense / Invoice, shown above an enlarged invoice image so they can be
// checked against the figures printed on it.
function InvoiceAmountBar({ expenseAmount, invoiceNumber, invoiceAmount }: { expenseAmount: string; invoiceNumber: string | null; invoiceAmount: string | null }) {
  const differs = invoiceAmount != null && Number(invoiceAmount) !== Number(expenseAmount);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        padding: '8px 14px',
        marginBottom: 10,
        borderRadius: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }}
    >
      {invoiceNumber && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Invoice No</div>
          <div style={{ fontWeight: 600 }}>{invoiceNumber}</div>
        </div>
      )}
      <div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Invoice Amount (input)</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: differs ? 'var(--warning)' : undefined }}>
          {invoiceAmount != null ? formatCurrency(invoiceAmount) : '-'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Expense Amount (input)</div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{formatCurrency(expenseAmount)}</div>
      </div>
    </div>
  );
}

// Activity photos + invoice files of one Expense (same popup as the Expenses list's eye button).
export default function ExpenseImagesModal({ expenseId, onClose }: { expenseId: string; onClose: () => void }) {
  const [expense, setExpense] = useState<ExpenseImages | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setExpense(null);
    setError('');
    api
      .get<ExpenseImages>(`/expenses/${expenseId}`)
      .then((d) => !cancelled && setExpense(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Failed to load images'));
    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  return (
    <Modal title="Expense Images" onClose={onClose} wide>
      {error && <div className="error-text">{error}</div>}
      {!expense && !error && <div>Loading...</div>}
      {expense && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              marginBottom: 16,
              borderRadius: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Expense</div>
              <div style={{ fontWeight: 600 }}>{expense.expenseNo}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Amount</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{formatCurrency(expense.amount)}</div>
            </div>
          </div>
          <strong>Activity Photos</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 16 }}>
            {expense.photos.map((p) => (
              <FileThumb key={p.id} path={`/expenses/photos/${p.id}/download`} fileName={p.fileName} isImage={p.mimeType.startsWith('image/')} />
            ))}
            {expense.photos.length === 0 && <div style={{ color: 'var(--muted)' }}>No activity photos</div>}
          </div>
          <strong>Invoice Photos</strong>
          {expense.invoices.length === 0 && <div style={{ color: 'var(--muted)', marginTop: 8 }}>No invoices</div>}
          {expense.invoices.map((inv) => (
            <div key={inv.id} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {inv.invoiceNumber || 'Invoice'}
                {inv.finalTotal != null && ` · ${formatCurrency(inv.finalTotal)}`}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {inv.files.map((f) => (
                  <FileThumb
                    key={f.id}
                    path={`/invoices/files/${f.id}/download`}
                    fileName={f.fileName}
                    isImage={f.mimeType.startsWith('image/')}
                    previewHeader={<InvoiceAmountBar expenseAmount={expense.amount} invoiceNumber={inv.invoiceNumber} invoiceAmount={inv.finalTotal} />}
                  />
                ))}
                {inv.files.length === 0 && <div style={{ color: 'var(--muted)' }}>No files</div>}
              </div>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
