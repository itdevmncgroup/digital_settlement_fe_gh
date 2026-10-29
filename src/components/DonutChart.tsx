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
// The hovered slice grows by HOVER_GROW and glows; HOVER_PAD keeps room for both inside the SVG so it is never cut off.
const HOVER_GROW = 4;
const HOVER_PAD = 10;
const RADIUS = (SIZE - STROKE - HOVER_PAD * 2) / 2;
const CIRC = 2 * Math.PI * RADIUS;

// Angles run clockwise from 12 o'clock. Each slice is its own arc so both ends are cut straight across the ring
// (a dashed full circle left a jagged notch where the last slice met the first).
const GAP_ANGLE = 0.035; // radians between neighbouring slices

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const x = (a: number) => cx + r * Math.sin(a);
  const y = (a: number) => cy - r * Math.cos(a);
  return `M ${x(a0)} ${y(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x(a1)} ${y(a1)}`;
}

export default function DonutChart({
  data,
  centerLabel,
  formatValue,
  legendBelow = false,
  legendHoverOnly = false,
}: {
  data: DonutRow[];
  centerLabel?: string;
  formatValue: (value: number) => string;
  /** Put the legend (names + values) under the chart instead of beside it. */
  legendBelow?: boolean;
  /** Don't print the hovered slice's name in the chart; instead the hovered legend row grows and turns brighter. */
  legendHoverOnly?: boolean;
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

  const shapeEvents = (id: string, color: string) => ({
    onMouseEnter: () => setHoverId(id),
    onMouseLeave: () => setHoverId(null),
    style: {
      cursor: 'default',
      transition: 'stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1), stroke-width 0.15s ease',
      filter: hoverId === id ? `drop-shadow(0 0 6px ${color})` : undefined,
    },
  });

  const total = data.reduce((sum, r) => sum + r.value, 0) || 1;
  const visible = data.filter((r) => r.value > 0).length;
  let offset = 0;
  const segments = data.map((row) => {
    const pct = row.value / total;
    const span = pct * 2 * Math.PI;
    const gap = visible > 1 && span > GAP_ANGLE * 3 ? GAP_ANGLE / 2 : 0;
    const seg = { ...row, pct, full: pct > 0.9999, a0: offset * 2 * Math.PI + gap, a1: (offset + pct) * 2 * Math.PI - gap };
    offset += pct;
    return seg;
  });

  const nameBelow = legendBelow;

  return (
    <div style={{ display: 'flex', gap: legendBelow ? 16 : 24, alignItems: 'center', flexWrap: 'wrap', flexDirection: legendBelow ? 'column' : 'row' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0, ...(legendBelow ? { width: '100%' } : {}) }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ overflow: 'visible' }}>
          <g>
            {segments.filter((seg) => seg.value > 0).map((seg) => {
              const common = {
                fill: 'none',
                stroke: seg.color,
                strokeWidth: hoverId === seg.id ? STROKE + HOVER_GROW : STROKE,
                // pathLength=1 lets the same 0 -> 1 dash animate every slice, whatever its length.
                pathLength: 1,
                strokeDasharray: `${animated ? 1 : 0} 1`,
              };
              const Shape = seg.full ? (
                <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} {...common} {...shapeEvents(seg.id, seg.color)} />
              ) : (
                <path d={arcPath(SIZE / 2, SIZE / 2, RADIUS, seg.a0, seg.a1)} {...common} {...shapeEvents(seg.id, seg.color)} />
              );
              return <g key={seg.id}>{Shape}</g>;
            })}
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
            {hoverId && !nameBelow && !legendHoverOnly ? data.find((d) => d.id === hoverId)?.label : centerLabel ?? 'Total'}
          </div>
        </div>
      </div>
      {nameBelow && (
        // Hovered slice's name sits under the chart (fixed height so nothing jumps on hover).
        <div
          style={{ height: 20, lineHeight: '20px', width: '100%', maxWidth: '100%', fontSize: 14, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={hoverId ? data.find((d) => d.id === hoverId)?.label : undefined}
        >
          {hoverId ? data.find((d) => d.id === hoverId)?.label : ''}
        </div>
      )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 160, ...(legendBelow ? { width: '100%', flex: 'none' } : {}) }}>
        {data.map((row) => (
          <div
            key={row.id}
            onMouseEnter={() => setHoverId(row.id)}
            onMouseLeave={() => setHoverId(null)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, cursor: 'default', ...(legendHoverOnly ? { minHeight: 24 } : {}) }}
          >
            <span
              style={{
                fontSize: legendHoverOnly && hoverId === row.id ? 16 : 13,
                fontWeight: 600,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                color: legendHoverOnly ? (hoverId === row.id ? 'var(--text)' : 'var(--muted)') : undefined,
                transition: 'font-size 0.12s ease, color 0.12s ease',
                ...(legendHoverOnly ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } : {}),
              }}
            >
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
