'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface AuditLog {
  id: string;
  action: string;
  objectType: string;
  objectId: string | null;
  timestamp: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  user?: { name: string } | null;
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : Array.isArray(v) ? v.join('; ') || '-' : String(v));

// An Expense UPDATE row stores only the fields that changed (plus expenseNo / status): "field: old -> new" per line.
function Changes({ log }: { log: AuditLog }) {
  const next = log.newValue;
  if (log.action !== 'UPDATE' || !next || typeof next !== 'object') return <span style={{ color: 'var(--muted)' }}>-</span>;
  const keys = Object.keys(next).filter((k) => k !== 'expenseNo' && k !== 'status' && k in (log.oldValue ?? {}));
  return (
    <div style={{ fontSize: 11 }}>
      {typeof next.expenseNo === 'string' && (
        <div style={{ color: 'var(--muted)' }}>
          {next.expenseNo} · status {show(log.oldValue?.status)}
        </div>
      )}
      {keys.length === 0 && !('invoiceUpdated' in next) && <div style={{ color: 'var(--muted)' }}>No field changed</div>}
      {'invoiceUpdated' in next && <div>Invoice updated</div>}
      {keys.map((k) => (
        <div key={k}>
          <strong>{k}</strong>: {show(log.oldValue?.[k])} → {show(next[k])}
        </div>
      ))}
    </div>
  );
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    api
      .get<AuditLog[]>('/audit-logs')
      .then(setLogs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [l.user?.name ?? 'system', l.action, l.objectType, l.objectId].some((v) => v?.toLowerCase().includes(q));
  });
  const pagination = usePagination(filteredLogs);

  return (
    <div>
      <div className="toolbar">
        <h1>Audit Log</h1>
        <SearchBox
          placeholder="Search user, action, object..."
          value={searchInput}
          onChange={setSearchInput}
          onSearch={() => setSearch(searchInput)}
        />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Object</th>
              <th>Object ID</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.timestamp)}</td>
                <td>{l.user?.name || 'system'}</td>
                <td>
                  <span className="badge">{l.action}</span>
                </td>
                <td>{l.objectType}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{l.objectId}</td>
                <td>
                  <Changes log={l} />
                </td>
              </tr>
            ))}
            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--muted)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredLogs.length > 0 && (
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
    </div>
  );
}
