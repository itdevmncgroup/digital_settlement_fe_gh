'use client';

import { useEffect, useRef, useState } from 'react';

interface DepartmentChartRow {
  id: string;
  name: string;
  /** Optional small muted line under the name, e.g. top submitters for a POD. */
  subtitle?: string;
  totalExpense: number;
  transactionCount: number;
}

const COLORS = ['#8b7bfb', '#ef5da8', '#3fd085', '#f7b955', '#5ec8f2', '#ff8a5c', '#c68bff', '#4fd1c5'];

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `Rp${(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

export default function DepartmentExpenseChart({ data }: { data: DepartmentChartRow[] }) {
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

  const sorted = [...data].sort((a, b) => Number(b.totalExpense) - Number(a.totalExpense));
  const total = sorted.reduce((sum, r) => sum + Number(r.totalExpense), 0) || 1;
  const max = Math.max(...sorted.map((r) => Number(r.totalExpense)), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sorted.map((row, i) => {
        const value = Number(row.totalExpense);
        const pct = (value / total) * 100;
        const widthPct = animated ? (value / max) * 100 : 0;
        const color = COLORS[i % COLORS.length];
        const isHover = hoverId === row.id;
        return (
          <div
            key={row.id}
            onMouseEnter={() => setHoverId(row.id)}
            onMouseLeave={() => setHoverId(null)}
            style={{ cursor: 'default' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: row.subtitle ? 'flex-start' : 'baseline', marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: color, boxShadow: `0 0 8px ${color}` }} />
                  {row.name}
                </span>
                {row.subtitle && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)', paddingLeft: 15 }}>{row.subtitle}</span>}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>
                {formatCompactCurrency(value)} <span style={{ opacity: 0.7 }}>· {pct.toFixed(1)}%</span>
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
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${widthPct}%`,
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, white))`,
                  boxShadow: isHover ? `0 0 12px ${color}` : `0 0 6px color-mix(in srgb, ${color} 50%, transparent)`,
                  transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease',
                  transitionDelay: `${i * 60}ms`,
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
