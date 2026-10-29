'use client';

import { useEffect, useRef, useState } from 'react';

export interface StatusSummaryRow {
  key: string;
  label: string;
  count: number;
  amount: number;
}

const COLORS: Record<string, string> = {
  COMPLETE: '#3fd085',
  PENDING_APPROVAL: '#f7b955',
  REJECTED: '#ef5da8',
};
const FALLBACK_COLOR = '#8b7bfb';

const SIZE = 190;
const STROKE = 24;
// The hovered slice grows by HOVER_GROW; HOVER_PAD keeps room for it inside the SVG so it is never cut off.
const HOVER_GROW = 4;
const HOVER_PAD = 8;
const RADIUS = (SIZE - STROKE - HOVER_PAD * 2) / 2;
// Angles run clockwise from 12 o'clock. Each slice is its own arc so both ends are cut straight across the ring.
const GAP_ANGLE = 0.035; // radians between neighbouring slices

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const x = (a: number) => cx + r * Math.sin(a);
  const y = (a: number) => cy - r * Math.cos(a);
  return `M ${x(a0)} ${y(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x(a1)} ${y(a1)}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

// Status summary for the Expense and Settlement dashboards: the three statuses of the Status filter (Complete / Pending Approval /
// Rejected), each with its exact transaction count and total amount. The donut is sized by transaction count,
// the thin bar under each row by amount, so both shares are readable at a glance. `selectedKey` (the applied
// Status filter) keeps its row highlighted and dims the others.
export default function StatusSummaryChart({ data, selectedKey }: { data: StatusSummaryRow[]; selectedKey?: string }) {
  const [animated, setAnimated] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    setAnimated(false);
    raf.current = requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [data]);

  const totalCount = data.reduce((sum, r) => sum + r.count, 0);
  const totalAmount = data.reduce((sum, r) => sum + r.amount, 0);

  if (data.length === 0 || totalCount === 0) {
    return <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>No data</div>;
  }

  const visible = data.filter((d) => d.count > 0).length;
  let offset = 0;
  const slices = data
    .filter((r) => r.count > 0)
    .map((r) => {
      const pct = r.count / totalCount;
      const gap = visible > 1 && pct * 2 * Math.PI > GAP_ANGLE * 3 ? GAP_ANGLE / 2 : 0;
      const slice = { row: r, full: pct > 0.9999, a0: offset * 2 * Math.PI + gap, a1: (offset + pct) * 2 * Math.PI - gap };
      offset += pct;
      return slice;
    });
  const focus = data.find((r) => r.key === (hoverKey ?? selectedKey));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 130px', padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total Transactions</div>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{totalCount}</div>
        </div>
        <div style={{ flex: '2 1 190px', padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total Amount</div>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{formatCurrency(totalAmount)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ overflow: 'visible' }}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
            {slices.map(({ row, full, a0, a1 }) => {
              const color = COLORS[row.key] ?? FALLBACK_COLOR;
              const active = hoverKey === row.key || (!hoverKey && selectedKey === row.key);
              const dimmed = (hoverKey || selectedKey) && !active && (hoverKey ?? selectedKey) !== row.key;
              const props = {
                fill: 'none',
                stroke: color,
                strokeWidth: active ? STROKE + HOVER_GROW : STROKE,
                // pathLength=1 lets the same 0 -> 1 dash animate every slice, whatever its length.
                pathLength: 1,
                strokeDasharray: `${animated ? 1 : 0} 1`,
                opacity: dimmed ? 0.4 : 1,
                onMouseEnter: () => setHoverKey(row.key),
                onMouseLeave: () => setHoverKey(null),
                style: { transition: 'stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1), stroke-width 0.15s ease, opacity 0.15s ease', cursor: 'default' },
              };
              return full ? (
                <circle key={row.key} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} {...props} />
              ) : (
                <path key={row.key} d={arcPath(SIZE / 2, SIZE / 2, RADIUS, a0, a1)} {...props} />
              );
            })}
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
              pointerEvents: 'none',
              padding: 26,
            }}
          >
            {focus ? (
              <>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{focus.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{focus.count}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{((focus.count / totalCount) * 100).toFixed(1)}% of transactions</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total Transactions</div>
                <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{totalCount}</div>
              </>
            )}
          </div>
        </div>

        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {data.map((r) => {
            const color = COLORS[r.key] ?? FALLBACK_COLOR;
            const countPct = (r.count / totalCount) * 100;
            const amountPct = totalAmount > 0 ? (r.amount / totalAmount) * 100 : 0;
            const active = hoverKey === r.key || (!hoverKey && selectedKey === r.key);
            const dimmed = (hoverKey ?? selectedKey) && (hoverKey ?? selectedKey) !== r.key;
            return (
              <div
                key={r.key}
                onMouseEnter={() => setHoverKey(r.key)}
                onMouseLeave={() => setHoverKey(null)}
                style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity 0.15s ease', cursor: 'default' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: color, boxShadow: active ? `0 0 8px ${color}` : undefined }} />
                    {r.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatCurrency(r.amount)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${animated ? amountPct : 0}%`,
                      borderRadius: 999,
                      background: color,
                      transition: 'width 0.8s cubic-bezier(0.16,1,0.3,1)',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  <span>
                    {r.count} transaction{r.count === 1 ? '' : 's'} · {countPct.toFixed(1)}%
                  </span>
                  <span>{amountPct.toFixed(1)}% of amount</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
