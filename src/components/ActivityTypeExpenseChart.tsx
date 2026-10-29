'use client';

import { useEffect, useRef, useState } from 'react';

interface ActivityTypeRow {
  id: string;
  name: string;
  totalExpense: number;
  transactionCount: number;
}

const COLORS = ['#8b7bfb', '#ef5da8', '#3fd085', '#f7b955', '#5ec8f2', '#ff8a5c', '#c68bff', '#4fd1c5'];

// Exact amounts (no K/Jt/M rounding) - this chart exists to state the total per Activity Type.
function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

// Expense by Activity Type for the dashboard's selected period: one ranked bar per Activity Type with
// its exact total, share of the period's total and transaction count, and a grand-total header.
export default function ActivityTypeExpenseChart({ data, periodLabel }: { data: ActivityTypeRow[]; periodLabel?: string }) {
  const [animated, setAnimated] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    setAnimated(false);
    raf.current = requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [data]);

  if (data.length === 0) {
    return <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>No data{periodLabel ? ` for ${periodLabel}` : ''}</div>;
  }

  const sorted = [...data].sort((a, b) => Number(b.totalExpense) - Number(a.totalExpense));
  const total = sorted.reduce((sum, r) => sum + Number(r.totalExpense), 0);
  const transactions = sorted.reduce((sum, r) => sum + r.transactionCount, 0);
  const max = Math.max(...sorted.map((r) => Number(r.totalExpense)), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 12,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'var(--surface-2)',
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total Expense{periodLabel ? ` · ${periodLabel}` : ''}</div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{formatCurrency(total)}</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {transactions} transaction{transactions === 1 ? '' : 's'}
          <br />
          {sorted.length} activity type{sorted.length === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sorted.map((row, i) => {
          const value = Number(row.totalExpense);
          const pct = total > 0 ? (value / total) * 100 : 0;
          const color = COLORS[i % COLORS.length];
          const isHover = hoverId === row.id;
          return (
            <div
              key={row.id}
              onMouseEnter={() => setHoverId(row.id)}
              onMouseLeave={() => setHoverId(null)}
              title={`${row.name}: ${formatCurrency(value)} (${pct.toFixed(1)}%) · ${row.transactionCount} transaction${row.transactionCount === 1 ? '' : 's'}`}
              style={{ cursor: 'default' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 999, background: color, boxShadow: `0 0 8px ${color}` }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatCurrency(value)}</span>
              </div>
              <div
                style={{
                  position: 'relative',
                  height: 10,
                  borderRadius: 999,
                  background: 'var(--surface-2)',
                  overflow: 'hidden',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${animated ? (value / max) * 100 : 0}%`,
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, white))`,
                    boxShadow: isHover ? `0 0 12px ${color}` : `0 0 6px color-mix(in srgb, ${color} 50%, transparent)`,
                    transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease',
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                <span>
                  {row.transactionCount} transaction{row.transactionCount === 1 ? '' : 's'}
                </span>
                <span>{pct.toFixed(1)}% of total</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
