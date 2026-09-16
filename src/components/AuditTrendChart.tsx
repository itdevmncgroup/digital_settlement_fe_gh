'use client';

import { useEffect, useRef, useState } from 'react';

interface TrendRow {
  month: string; // yyyy-MM
  totalExpense: number;
  totalSettled: number;
  exceptionsCount: number;
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(0)}Jt`;
  if (abs >= 1_000) return `Rp${(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${y}`;
}

const WIDTH = 640;
const HEIGHT = 240;
const PAD_LEFT = 12;
const PAD_RIGHT = 12;
const PAD_TOP = 34;
const PAD_BOTTOM = 28;

// Two money-scale series (Total Expenses/Total Settled) plus one count-scale
// series (audit exceptions) sharing an x-axis - the count series is normalized
// against its own max so a handful of exceptions is still visible next to
// amounts in the millions.
const SERIES = [
  { key: 'totalExpense' as const, label: 'Total Expenses', color: '#8b7bfb', axis: 'money' as const },
  { key: 'totalSettled' as const, label: 'Total Settled', color: '#3fd085', axis: 'money' as const },
  { key: 'exceptionsCount' as const, label: 'Audit Exceptions', color: '#f0605f', axis: 'count' as const },
];

export default function AuditTrendChart({ data }: { data: TrendRow[] }) {
  const [animated, setAnimated] = useState(false);
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

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const moneyMax = Math.max(...data.flatMap((d) => [d.totalExpense, d.totalSettled]), 1);
  const countMax = Math.max(...data.map((d) => d.exceptionsCount), 1);
  const slot = data.length > 1 ? plotWidth / (data.length - 1) : 0;

  const linesData = SERIES.map((s) => {
    const max = s.axis === 'money' ? moneyMax : countMax;
    const points = data.map((d, i) => {
      const x = data.length > 1 ? PAD_LEFT + slot * i : PAD_LEFT + plotWidth / 2;
      const value = d[s.key];
      const y = PAD_TOP + plotHeight - (value / max) * plotHeight;
      return { x, y, value };
    });
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${animated ? p.y : PAD_TOP + plotHeight}`).join(' ');
    return { ...s, points, path };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
        {SERIES.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {linesData.map((line) => (
          <g key={line.key}>
            <path d={line.path} fill="none" stroke={line.color} strokeWidth={2.5} style={{ transition: 'd 0.7s cubic-bezier(0.16,1,0.3,1)' }} />
            {line.points.map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={animated ? p.y : PAD_TOP + plotHeight}
                  r={4}
                  fill={line.color}
                  style={{ transition: 'cy 0.7s cubic-bezier(0.16,1,0.3,1)' }}
                />
                <text
                  x={p.x}
                  y={animated ? p.y - 10 : PAD_TOP + plotHeight - 10}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight={600}
                  fill={line.color}
                  style={{ transition: 'y 0.7s cubic-bezier(0.16,1,0.3,1)' }}
                >
                  {line.axis === 'money' ? formatCompactCurrency(p.value) : p.value}
                </text>
              </g>
            ))}
          </g>
        ))}
        {data.map((d, i) => {
          const x = data.length > 1 ? PAD_LEFT + slot * i : PAD_LEFT + plotWidth / 2;
          return (
            <text key={d.month} x={x} y={HEIGHT - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {formatMonthLabel(d.month)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
