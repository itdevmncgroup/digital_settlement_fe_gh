'use client';

import { ChangeEvent, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, uploadFile } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/date';
import { usePagination } from '@/lib/usePagination';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface BatchRow {
  id: string;
  fileName: string;
  createdAt: string;
  uploadedBy: { name: string };
  _count: { transactions: number };
}

interface MatchedExpense {
  id: string;
  expenseNo: string;
  amount: string;
  expenseDate: string;
  sales: { name: string };
  advertiser: { name: string };
  brand: { name: string };
}

interface TransactionRow {
  id: string;
  lineNo: number;
  transactionDate: string | null;
  rawDescription: string;
  amount: string;
  cardLast4: string | null;
  status: 'UNMATCHED' | 'AUTO_MATCHED' | 'REVIEW_REQUIRED' | 'MANUAL_MATCHED';
  matchScore: string | null;
  matchedExpense: MatchedExpense | null;
}

interface BatchDetail extends BatchRow {
  transactions: TransactionRow[];
  alreadyScanned?: boolean;
}

interface ExpenseSearchResult {
  id: string;
  expenseNo: string;
  amount: string;
  expenseDate: string;
  sales: { name: string };
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

function StatusBadge({ status }: { status: TransactionRow['status'] }) {
  const cls =
    status === 'AUTO_MATCHED' || status === 'MANUAL_MATCHED'
      ? 'badge-success'
      : status === 'REVIEW_REQUIRED'
      ? 'badge-warning'
      : 'badge-info';
  const label = status === 'UNMATCHED' ? 'NOT MATCHED' : status.replace(/_/g, ' ');
  return <span className={`badge ${cls}`}>{label}</span>;
}

function MatchPicker({ onPick }: { onPick: (expenseId: string) => void }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ExpenseSearchResult[]>([]);
  const [open, setOpen] = useState(false);

  const search = () => {
    if (!term.trim()) return;
    api
      .get<ExpenseSearchResult[]>(`/expenses?search=${encodeURIComponent(term)}`)
      .then((rows) => {
        setResults(rows);
        setOpen(true);
      })
      .catch(() => undefined);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          placeholder="Search expense no..."
          value={term}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          style={{ width: 160 }}
        />
        <button type="button" className="btn" onClick={search}>
          Search
        </button>
      </div>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', zIndex: 10, top: '100%', marginTop: 4, width: 320, maxHeight: 220, overflowY: 'auto' }}
        >
          {results.map((r) => (
            <div
              key={r.id}
              style={{ padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
              onClick={() => {
                onPick(r.id);
                setOpen(false);
                setTerm('');
              }}
            >
              {r.expenseNo} — {r.sales?.name} — {formatCurrency(r.amount)} ({formatDate(r.expenseDate)})
            </div>
          ))}
          {results.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: 4 }}>No results</div>}
        </div>
      )}
    </div>
  );
}

export default function BankMatchingPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BankMatchingPageInner />
    </Suspense>
  );
}

function BankMatchingPageInner() {
  const searchParams = useSearchParams();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{ fileName: string; resolve: (rescan: boolean) => void } | null>(null);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchSearchInput, setBatchSearchInput] = useState('');
  const [txnSearch, setTxnSearch] = useState('');
  const [txnSearchInput, setTxnSearchInput] = useState('');

  const filteredBatches = batches.filter((b) => {
    if (!batchSearch) return true;
    const q = batchSearch.toLowerCase();
    return [b.fileName, b.uploadedBy?.name].some((v) => v?.toLowerCase().includes(q));
  });
  const batchPagination = usePagination(filteredBatches);

  const filteredTransactions = (selectedBatch?.transactions ?? []).filter((t) => {
    if (!txnSearch) return true;
    const q = txnSearch.toLowerCase();
    return [t.rawDescription, t.matchedExpense?.expenseNo, t.matchedExpense?.sales?.name].some((v) => v?.toLowerCase().includes(q));
  });
  const txnPagination = usePagination(filteredTransactions);

  const loadBatches = () => {
    api.get<BatchRow[]>('/bank-settlements').then(setBatches).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(loadBatches, []);

  const openBatch = (id: string) => {
    setTxnSearch('');
    setTxnSearchInput('');
    api
      .get<BatchDetail>(`/bank-settlements/${id}`)
      .then(setSelectedBatch)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  // Landing here from the Expenses page's "Statement" column link (?batchId=...)
  // pre-opens that batch's transactions.
  useEffect(() => {
    const batchId = searchParams.get('batchId');
    if (batchId) openBatch(batchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Resolves once the user picks IYA (true) or TIDAK (false) in the modal below
  // - lets the sequential upload loop `await` a per-file decision instead of
  // needing a separate confirm component with its own state machine.
  const confirmRescan = (fileName: string): Promise<boolean> =>
    new Promise((resolve) => setDuplicateConfirm({ fileName, resolve }));

  // Uploads each PDF one at a time (the endpoint only takes one file per call) so a
  // Finance user can drop a whole batch of bank settlement PDFs at once. A file
  // whose content was already scanned before is *not* reparsed automatically -
  // instead the user is asked per file: IYA re-scans the PDF from scratch
  // (?force=true, same full rebuild as before); TIDAK skips the scan but still
  // re-runs matching against current Expense data via the new rematch endpoint.
  const onUpload = async (files: File[]) => {
    setUploading(true);
    setError('');
    let lastBatch: BatchDetail | null = null;
    try {
      for (const file of files) {
        let result = (await uploadFile('/bank-settlements', file)) as BatchDetail;
        if (result.alreadyScanned) {
          const rescan = await confirmRescan(file.name);
          result = rescan
            ? ((await uploadFile('/bank-settlements', file, '?force=true')) as BatchDetail)
            : ((await api.post(`/bank-settlements/${result.id}/rematch`)) as BatchDetail);
        }
        lastBatch = result;
      }
      loadBatches();
      if (lastBatch) setSelectedBatch(lastBatch);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
      loadBatches();
    } finally {
      setUploading(false);
    }
  };

  const manualMatch = async (transactionId: string, expenseId: string) => {
    if (!selectedBatch) return;
    setBusy(true);
    try {
      await api.post(`/bank-settlements/transactions/${transactionId}/match`, { expenseId });
      openBatch(selectedBatch.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Match failed');
    } finally {
      setBusy(false);
    }
  };

  const unmatch = async (transactionId: string) => {
    if (!selectedBatch) return;
    setBusy(true);
    try {
      await api.post(`/bank-settlements/transactions/${transactionId}/unmatch`);
      openBatch(selectedBatch.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unmatch failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Auto Matching</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            {uploading ? 'Uploading...' : '+ Upload Bank Settlement (PDF, bisa lebih dari 1)'}
            <input
              type="file"
              accept="application/pdf"
              multiple
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) onUpload(files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8, fontSize: 12 }}>
        Upload a bank/credit-card settlement PDF to reconcile it against submitted Expenses by amount, date and merchant name.
      </p>

      {error && <div className="error-text">{error}</div>}

      {duplicateConfirm && (
        <Modal
          title="File sudah pernah discan"
          onClose={() => {
            duplicateConfirm.resolve(false);
            setDuplicateConfirm(null);
          }}
        >
          <p style={{ fontSize: 13, marginTop: 0 }}>
            {duplicateConfirm.fileName}: file sudah pernah discan, apakah ingin scan ulang atau tidak?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                duplicateConfirm.resolve(false);
                setDuplicateConfirm(null);
              }}
            >
              TIDAK
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                duplicateConfirm.resolve(true);
                setDuplicateConfirm(null);
              }}
            >
              IYA
            </button>
          </div>
        </Modal>
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        <div className="card" style={{ flex: 1, maxWidth: 360 }}>
          <h3 style={{ marginTop: 0 }}>Batches</h3>
          <SearchBox
            placeholder="Search file, uploader..."
            value={batchSearchInput}
            onChange={setBatchSearchInput}
            onSearch={() => setBatchSearch(batchSearchInput)}
            style={{ marginBottom: 8 }}
          />
          {batchPagination.pageRows.map((b) => (
            <div
              key={b.id}
              onClick={() => openBatch(b.id)}
              style={{
                padding: '8px 4px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                background: selectedBatch?.id === b.id ? 'var(--hover, rgba(0,0,0,0.04))' : undefined,
              }}
            >
              <div style={{ fontSize: 13 }}>{b.fileName}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {formatDateTime(b.createdAt)} · {b._count.transactions} lines · {b.uploadedBy?.name}
              </div>
            </div>
          ))}
          {filteredBatches.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No batches uploaded yet</div>}
          {filteredBatches.length > 0 && (
            <Pagination
              page={batchPagination.page}
              totalPages={batchPagination.totalPages}
              pageSize={batchPagination.pageSize}
              onPageChange={batchPagination.setPage}
              onPageSizeChange={batchPagination.setPageSize}
              total={batchPagination.total}
              rangeStart={batchPagination.rangeStart}
              rangeEnd={batchPagination.rangeEnd}
            />
          )}
        </div>

        <div className="card" style={{ flex: 2 }}>
          <h3 style={{ marginTop: 0 }}>Transactions</h3>
          {!selectedBatch && <div style={{ color: 'var(--muted)' }}>Select a batch to view its transactions</div>}
          {selectedBatch && (
            <SearchBox
              placeholder="Search description, matched expense..."
              value={txnSearchInput}
              onChange={setTxnSearchInput}
              onSearch={() => setTxnSearch(txnSearchInput)}
              style={{ marginBottom: 8 }}
            />
          )}
          {selectedBatch && (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Matched Expense</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {txnPagination.pageRows.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.transactionDate)}</td>
                    <td style={{ maxWidth: 220 }}>{t.rawDescription}</td>
                    <td>{formatCurrency(t.amount)}</td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>
                      {t.matchedExpense ? (
                        <span style={{ fontSize: 12 }}>
                          {t.matchedExpense.expenseNo} ({t.matchedExpense.sales?.name})
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                        {t.status !== 'UNMATCHED' && (
                          <button className="btn btn-danger" disabled={busy} onClick={() => unmatch(t.id)}>
                            Unmatch
                          </button>
                        )}
                        <MatchPicker onPick={(expenseId) => manualMatch(t.id, expenseId)} />
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTransactions.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--muted)' }}>
                      No transactions parsed from this file
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {selectedBatch && filteredTransactions.length > 0 && (
            <Pagination
              page={txnPagination.page}
              totalPages={txnPagination.totalPages}
              pageSize={txnPagination.pageSize}
              onPageChange={txnPagination.setPage}
              onPageSizeChange={txnPagination.setPageSize}
              total={txnPagination.total}
              rangeStart={txnPagination.rangeStart}
              rangeEnd={txnPagination.rangeEnd}
            />
          )}
        </div>
      </div>
    </div>
  );
}
