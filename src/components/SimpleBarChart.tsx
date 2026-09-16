'use client';

import { useEffect, useRef, useState } from 'react';

interface BarRow {
  id: string;
  name: string;
  value: number;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD_TOP = 24;
const PAD_BOTTOM = 28;

// Single-series vertical bar chart - e.g. average processing days per POD, or
// (with formatValue) a compact-currency breakdown like Expense by Category.
export default function SimpleBarChart({
  data,
  valueSuffix = '',
  color = '#8b7bfb',
  formatValue,
}: {
  data: BarRow[];
  valueSuffix?: string;
  color?: string;
  formatValue?: (value: number) => string;
}) {
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

  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = WIDTH / data.length;
  const barWidth = Math.min(48, slot * 0.5);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
      {data.map((d, i) => {
        const x = slot * i + slot / 2;
        const barHeight = animated ? (d.value / max) * plotHeight : 0;
        const isHover = hoverIndex === i;
        return (
          <g key={d.id} onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)} style={{ cursor: 'default' }}>
            <text x={x} y={PAD_TOP + plotHeight - barHeight - 8} textAnchor="middle" fontSize="11" fontWeight={600} fill="var(--text)">
              {formatValue ? formatValue(d.value) : `${d.value.toFixed(1)}${valueSuffix}`}
            </text>
            <rect
              x={x - barWidth / 2}
              y={PAD_TOP + plotHeight - barHeight}
              width={barWidth}
              height={barHeight}
              rx={4}
              fill={isHover ? color : `color-mix(in srgb, ${color} 85%, transparent)`}
              style={{ transition: 'height 0.7s cubic-bezier(0.16,1,0.3,1), y 0.7s cubic-bezier(0.16,1,0.3,1)', transitionDelay: `${i * 40}ms` }}
            />
            <text x={x} y={HEIGHT - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {d.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
