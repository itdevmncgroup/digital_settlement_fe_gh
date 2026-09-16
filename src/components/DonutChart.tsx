'use client';

import { useEffect, useRef, useState } from 'react';

interface DonutRow {
  id: string;
  label: string;
  value: number;
  color: string;
  /** Optional small muted line under the label, e.g. PIC name. */
  subtitle?: string;
}

const SIZE = 200;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

export default function DonutChart({
  data,
  centerLabel,
  formatValue,
}: {
  data: DonutRow[];
  centerLabel?: string;
  formatValue: (value: number) => string;
}) {
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

  const total = data.reduce((sum, r) => sum + r.value, 0) || 1;
  let offset = 0;
  const segments = data.map((row) => {
    const pct = row.value / total;
    const dash = animated ? pct * CIRC : 0;
    const seg = { ...row, pct, dashArray: `${dash} ${CIRC - dash}`, dashOffset: -offset * CIRC };
    offset += pct;
    return seg;
  });

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {segments.map((seg) => (
              <circle
                key={seg.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={seg.color}
                strokeWidth={hoverId === seg.id ? STROKE + 4 : STROKE}
                strokeDasharray={seg.dashArray}
                strokeDashoffset={seg.dashOffset}
                onMouseEnter={() => setHoverId(seg.id)}
                onMouseLeave={() => setHoverId(null)}
                style={{
                  cursor: 'default',
                  transition: 'stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1), stroke-width 0.15s ease',
                  filter: hoverId === seg.id ? `drop-shadow(0 0 6px ${seg.color})` : undefined,
                }}
              />
            ))}
          </g>
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 8,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {hoverId ? formatValue(data.find((d) => d.id === hoverId)!.value) : formatValue(total)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {hoverId ? data.find((d) => d.id === hoverId)?.label : centerLabel ?? 'Total'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 160 }}>
        {data.map((row) => (
          <div
            key={row.id}
            onMouseEnter={() => setHoverId(row.id)}
            onMouseLeave={() => setHoverId(null)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, cursor: 'default' }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: row.color, boxShadow: `0 0 8px ${row.color}` }} />
                {row.label}
              </span>
              {row.subtitle && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)', paddingLeft: 15 }}>{row.subtitle}</span>}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {formatValue(row.value)} <span style={{ opacity: 0.7 }}>({((row.value / total) * 100).toFixed(1)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
