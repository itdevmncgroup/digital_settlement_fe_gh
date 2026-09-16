'use client';

import { useEffect, useRef, useState } from 'react';

interface TrendRow {
  month: string; // yyyy-MM
  total: number;
  count: number;
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `Rp${(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${String(y).slice(2)}`;
}

const WIDTH = 720;
const HEIGHT = 220;
const PAD_LEFT = 12;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

// Bars = total amount (left-scale). Line+dots = transaction count (right-scale,
// normalized independently so it stays readable next to amounts of a very
// different magnitude).
export default function TransactionTrendChart({ data }: { data: TrendRow[] }) {
  const [animated, setAnimated] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const slot = plotWidth / data.length;
  const barWidth = Math.min(36, slot * 0.5);

  const points = data.map((d, i) => {
    const x = PAD_LEFT + slot * i + slot / 2;
    const y = PAD_TOP + plotHeight - (d.count / maxCount) * plotHeight;
    return { x, y, d };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${animated ? p.y : PAD_TOP + plotHeight}`).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#8b7bfb' }} /> Amount
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: '#3fd085' }} /> Transactions
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {points.map(({ x, d }, i) => {
          const barHeight = animated ? (d.total / maxTotal) * plotHeight : 0;
          return (
            <g key={d.month} onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)} style={{ cursor: 'default' }}>
              <rect
                x={x - barWidth / 2}
                y={PAD_TOP + plotHeight - barHeight}
                width={barWidth}
                height={barHeight}
                rx={4}
                fill={hoverIndex === i ? '#a596ff' : '#8b7bfb'}
                style={{ transition: 'height 0.7s cubic-bezier(0.16,1,0.3,1), y 0.7s cubic-bezier(0.16,1,0.3,1)', transitionDelay: `${i * 40}ms` }}
              />
              <text x={x} y={HEIGHT - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {formatMonthLabel(d.month)}
              </text>
            </g>
          );
        })}
        <path
          d={linePath}
          fill="none"
          stroke="#3fd085"
          strokeWidth={2}
          style={{ transition: 'd 0.7s cubic-bezier(0.16,1,0.3,1)' }}
        />
        {points.map(({ x, y, d }, i) => (
          <circle
            key={`dot-${d.month}`}
            cx={x}
            cy={animated ? y : PAD_TOP + plotHeight}
            r={hoverIndex === i ? 5 : 3.5}
            fill="#3fd085"
            style={{ transition: 'cy 0.7s cubic-bezier(0.16,1,0.3,1), r 0.15s ease' }}
          />
        ))}
      </svg>
      {hoverIndex !== null && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {formatMonthLabel(data[hoverIndex].month)} — {formatCompactCurrency(data[hoverIndex].total)} ·{' '}
          {data[hoverIndex].count} transaction{data[hoverIndex].count === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
