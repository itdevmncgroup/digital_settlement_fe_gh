'use client';

import { useEffect, useRef, useState } from 'react';

interface ProcessingTimeRow {
  id: string;
  name: string;
  averageDays: number;
  /** Sent settlements the average is based on. */
  count?: number;
  minDays?: number;
  maxDays?: number;
}

const FAST_COLOR = '#3fd085';
const SLOW_COLOR = '#f7b955';

// Under a day reads better in hours; everything else in days.
function formatDuration(days: number) {
  if (days < 1) return `${(days * 24).toFixed(1)} h`;
  return `${days.toFixed(1)} d`;
}

// Average processing time (Settlement created -> sent to Odoo) per POD for the dashboard's selected period.
// Slowest POD first; each bar is coloured by whether that POD is faster or slower than the overall average
// (weighted by number of settlements), which is also drawn as a dashed marker across the bars.
export default function ProcessingTimeChart({ data, periodLabel }: { data: ProcessingTimeRow[]; periodLabel?: string }) {
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
    return (
      <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>
        No settlement sent to Odoo{periodLabel ? ` in ${periodLabel}` : ''} yet
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.averageDays - a.averageDays);
  const totalCount = sorted.reduce((sum, r) => sum + (r.count ?? 1), 0);
  const overall = sorted.reduce((sum, r) => sum + r.averageDays * (r.count ?? 1), 0) / totalCount;
  const slowest = sorted[0];
  const fastest = sorted[sorted.length - 1];
  const max = Math.max(...sorted.map((r) => Math.max(r.averageDays, r.maxDays ?? 0)), overall, 0.01);
  const overallPct = (overall / max) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="Overall Average" value={formatDuration(overall)} sub={`${totalCount} settlement${totalCount === 1 ? '' : 's'} sent`} />
        <Stat label="Fastest POD" value={fastest.name} sub={formatDuration(fastest.averageDays)} />
        <Stat label="Slowest POD" value={slowest.name} sub={formatDuration(slowest.averageDays)} />
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 6, borderRadius: 3, background: FAST_COLOR }} /> At or faster than average
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 6, borderRadius: 3, background: SLOW_COLOR }} /> Slower than average
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 0, height: 10, borderLeft: '2px dashed var(--muted)' }} /> Overall average
        </span>
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* overall-average marker, drawn over every bar track */}
        <div
          aria-hidden="true"
          style={{ position: 'absolute', top: 18, bottom: 16, left: `${overallPct}%`, borderLeft: '2px dashed var(--muted)', opacity: 0.55, pointerEvents: 'none' }}
        />
        {sorted.map((row, i) => {
          const slower = row.averageDays > overall;
          const color = slower ? SLOW_COLOR : FAST_COLOR;
          const isHover = hoverId === row.id;
          const diff = row.averageDays - overall;
          return (
            <div key={row.id} onMouseEnter={() => setHoverId(row.id)} onMouseLeave={() => setHoverId(null)} style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 999, background: color, boxShadow: isHover ? `0 0 8px ${color}` : undefined }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatDuration(row.averageDays)}</span>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${animated ? (row.averageDays / max) * 100 : 0}%`,
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, white))`,
                    boxShadow: isHover ? `0 0 12px ${color}` : `0 0 6px color-mix(in srgb, ${color} 50%, transparent)`,
                    transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease',
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--muted)', marginTop: 4, flexWrap: 'wrap' }}>
                <span>
                  {row.count !== undefined ? `${row.count} settlement${row.count === 1 ? '' : 's'}` : ''}
                  {row.minDays !== undefined && row.maxDays !== undefined && row.count !== undefined && row.count > 1
                    ? ` · ${formatDuration(row.minDays)} – ${formatDuration(row.maxDays)}`
                    : ''}
                </span>
                <span style={{ color: slower ? SLOW_COLOR : FAST_COLOR }}>
                  {Math.abs(diff) < 0.05 ? 'on average' : `${formatDuration(Math.abs(diff))} ${slower ? 'slower' : 'faster'}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: '1 1 110px', padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}
