'use client';

import { PAGE_SIZE_OPTIONS } from '@/lib/usePagination';

interface PaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  total: number;
  rangeStart: number;
  rangeEnd: number;
}

export default function Pagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  total,
  rangeStart,
  rangeEnd,
}: PaginationProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 12,
        paddingTop: 12,
        borderTop: '1px solid var(--border-soft)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
        <span>
          {total === 0 ? 'No data' : `${rangeStart}-${rangeEnd} of ${total}`}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ width: 'auto', padding: '4px 8px' }}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="btn" disabled={page <= 1} onClick={() => onPageChange(1)}>
          «
        </button>
        <button className="btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ‹
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)', padding: '0 4px' }}>
          Page {page} of {totalPages}
        </span>
        <button className="btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          ›
        </button>
        <button className="btn" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>
          »
        </button>
      </div>
    </div>
  );
}
