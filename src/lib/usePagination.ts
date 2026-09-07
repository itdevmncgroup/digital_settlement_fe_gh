import { useEffect, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Client-side paging over an already-fetched array: table lists here don't
// have server-side page/pageSize support, so this just slices what's in
// memory. Resets to page 1 whenever the source rows change size (a new
// search/filter applied) so the user isn't stranded on a now-empty page.
export function usePagination<T>(rows: T[], initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(1);
  }, [total, pageSize]);

  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    pageRows,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + pageSize, total),
  };
}
