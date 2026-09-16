'use client';

import { useEffect, useRef, useState } from 'react';

interface PodRow {
  id: string;
  name: string;
  totalExpense: number;
  settled: number;
  outstanding: number;
  transactionCount: number;
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(0)} Juta`;
  if (abs >= 1_000) return `Rp${(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

const LEGEND = [
  { key: 'total', label: 'Total Expenses', color: '#8b7bfb' },
  { key: 'settled', label: 'Settled', color: '#3fd085' },
  { key: 'outstanding', label: 'Outstanding', color: '#ef5da8' },
];

// Stacked bar per POD (settled + outstanding = total expense), with the 3
// headline amounts printed alongside - mirrors the "Expenses vs Settlement by
// POD" panel's bar-plus-figures layout.
export default function PodExpenseSettlementChart({ data }: { data: PodRow[] }) {
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
    return <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>No data</div>;
  }

  const sorted = [...data].sort((a, b) => b.totalExpense - a.totalExpense);
  const max = Math.max(...sorted.map((r) => r.totalExpense), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--muted)', flexWrap: 'wrap' }}>
        {LEGEND.map((l) => (
          <span key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: l.color }} /> {l.label}
          </span>
        ))}
      </div>
      {sorted.map((row, i) => {
        const settledWidth = animated ? (row.settled / max) * 100 : 0;
        const outstandingWidth = animated ? (row.outstanding / max) * 100 : 0;
        const isHover = hoverId === row.id;
        return (
          <div key={row.id} onMouseEnter={() => setHoverId(row.id)} onMouseLeave={() => setHoverId(null)} style={{ cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{row.name}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--text)' }}>{formatCompactCurrency(row.totalExpense)}</span>
                {' | '}
                <span style={{ color: '#3fd085' }}>{formatCompactCurrency(row.settled)}</span>
                {' | '}
                <span style={{ color: '#ef5da8' }}>{formatCompactCurrency(row.outstanding)}</span>
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 10,
                borderRadius: 999,
                background: 'var(--surface-2)',
                overflow: 'hidden',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)',
                display: 'flex',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${settledWidth}%`,
                  background: 'linear-gradient(90deg, #3fd085, color-mix(in srgb, #3fd085 60%, white))',
                  boxShadow: isHover ? '0 0 12px #3fd085' : undefined,
                  transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                  transitionDelay: `${i * 60}ms`,
                }}
              />
              <div
                style={{
                  height: '100%',
                  width: `${outstandingWidth}%`,
                  background: 'linear-gradient(90deg, #ef5da8, color-mix(in srgb, #ef5da8 60%, white))',
                  boxShadow: isHover ? '0 0 12px #ef5da8' : undefined,
                  transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                  transitionDelay: `${i * 60 + 80}ms`,
                }}
              />
            </div>
            {isHover && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {row.transactionCount} transaction{row.transactionCount === 1 ? '' : 's'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
