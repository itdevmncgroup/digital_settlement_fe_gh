'use client';

export type TotalsBucket = 'complete' | 'pending' | 'rejected';

export interface TransactionTotals {
  complete: { amount: number; count: number };
  pending: { amount: number; count: number };
  rejected: { amount: number; count: number };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

// Sums rows into the three buckets; `bucketOf` decides which one a row belongs to.
export function sumByBucket<T>(rows: T[], bucketOf: (row: T) => TotalsBucket, amountOf: (row: T) => string | number): TransactionTotals {
  const totals: TransactionTotals = {
    complete: { amount: 0, count: 0 },
    pending: { amount: 0, count: 0 },
    rejected: { amount: 0, count: 0 },
  };
  for (const row of rows) {
    const b = totals[bucketOf(row)];
    b.amount += Number(amountOf(row)) || 0;
    b.count += 1;
  }
  return totals;
}

const CARDS: { bucket: TotalsBucket; label: string; color: string }[] = [
  { bucket: 'complete', label: 'Completed', color: 'var(--success)' },
  { bucket: 'pending', label: 'Pending', color: 'var(--warning)' },
  { bucket: 'rejected', label: 'Rejected', color: 'var(--danger)' },
];

// List-page summary: Total Amount and Total Transaction for Completed / Pending / Rejected, over the rows the list
// currently shows (so it follows the page's filters). Clicking a card selects its bucket - the page then lists only
// those rows in its table - and clicking it again (or the other bucket's card) toggles / switches.
export default function TransactionTotalsCards({
  totals,
  selected = null,
  onSelect,
}: {
  totals: TransactionTotals;
  selected?: TotalsBucket | null;
  onSelect?: (bucket: TotalsBucket | null) => void;
}) {
  const card = (bucket: TotalsBucket, kind: 'amount' | 'count', label: string, color: string) => {
    const isSelected = selected === bucket;
    const dimmed = selected !== null && !isSelected;
    return (
      <div
        className="stat"
        key={`${bucket}-${kind}`}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        aria-pressed={onSelect ? isSelected : undefined}
        title={onSelect ? (isSelected ? 'Click to show all' : `Click to list only ${label.toLowerCase()} rows`) : undefined}
        onClick={onSelect ? () => onSelect(isSelected ? null : bucket) : undefined}
        onKeyDown={
          onSelect
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isSelected ? null : bucket);
                }
              }
            : undefined
        }
        style={{
          cursor: onSelect ? 'pointer' : undefined,
          opacity: dimmed ? 0.55 : 1,
          outline: isSelected ? `2px solid ${color}` : undefined,
          outlineOffset: -2,
          transition: 'opacity 0.15s ease, outline-color 0.15s ease',
        }}
      >
        <div className="label">
          Total {label} {kind === 'amount' ? 'Amount' : 'Transaction'}
        </div>
        <div className="value" style={{ color, fontSize: kind === 'amount' ? 20 : undefined }}>
          {kind === 'amount' ? formatCurrency(totals[bucket].amount) : totals[bucket].count}
        </div>
      </div>
    );
  };
  return (
    <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
      {CARDS.flatMap(({ bucket, label, color }) => [card(bucket, 'amount', label, color), card(bucket, 'count', label, color)])}
    </div>
  );
}
