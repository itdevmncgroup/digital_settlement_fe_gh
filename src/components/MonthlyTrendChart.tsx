'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface TrendRow {
  month: string; // yyyy-MM
  total: number;
  count: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AMOUNT_COLOR = '#8b7bfb';
const COUNT_COLOR = '#3fd085';
const MAX_MONTHS = 36;

const WIDTH = 760;
const HEIGHT = 280;
const PAD_LEFT = 64;
const PAD_RIGHT = 40;
const PAD_TOP = 14;
const PAD_BOTTOM = 30;
const TICKS = 4;

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${+(value / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp${+(value / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `Rp${+(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

function monthLabel(month: string, withYear = true) {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return withYear ? `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}` : MONTH_NAMES[m - 1];
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Every month between the picked From/To dates (months without expenses count as 0), so the
// trend shows real gaps instead of silently skipping them. Without a From/To it spans the data.
function fillMonths(data: TrendRow[], from?: string, to?: string): TrendRow[] {
  const byMonth = new Map(data.map((d) => [d.month, d]));
  const sortedKeys = [...byMonth.keys()].sort();
  const startKey = from ? from.slice(0, 7) : sortedKeys[0];
  const endKey = to ? to.slice(0, 7) : sortedKeys[sortedKeys.length - 1];
  if (!startKey || !endKey || startKey > endKey) return data;

  const rows: TrendRow[] = [];
  const cursor = new Date(Number(startKey.slice(0, 4)), Number(startKey.slice(5, 7)) - 1, 1);
  while (monthKey(cursor) <= endKey && rows.length < MAX_MONTHS * 4) {
    const key = monthKey(cursor);
    rows.push(byMonth.get(key) ?? { month: key, total: 0, count: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  // A very long range is cut to its most recent months to stay readable.
  return rows.slice(-MAX_MONTHS);
}

// Smallest 1/2/5 x 10^k at or above the value, so the axis ends on a round number.
function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function changePct(curr: number, prev: number): number | null {
  return prev > 0 ? ((curr - prev) / prev) * 100 : null;
}

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: 'var(--muted)' }}>–</span>;
  const up = pct >= 0;
  return (
    <span style={{ color: up ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// Monthly trend for a dashboard's selected period (Expense and Settlement dashboards): bars = total amount (left axis), line = number of
// transactions (right axis), each with its own scale, plus a summary of the period and a hover tooltip with exact values.
export default function MonthlyTrendChart({
  data,
  from,
  to,
  amountLabel = 'Total Expense',
}: {
  data: TrendRow[];
  from?: string;
  to?: string;
  /** What the amount is called, e.g. "Total Expense" / "Total Settlement". */
  amountLabel?: string;
}) {
  const [animated, setAnimated] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const raf = useRef<number | null>(null);

  const rows = useMemo(() => fillMonths(data, from, to), [data, from, to]);

  useEffect(() => {
    setAnimated(false);
    raf.current = requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [rows]);

  if (rows.length === 0) {
    return <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>No data</div>;
  }

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseY = PAD_TOP + plotHeight;
  const amountMax = niceMax(Math.max(...rows.map((r) => r.total), 1));
  const countMax = Math.max(4, Math.ceil(Math.max(...rows.map((r) => r.count), 1) / TICKS) * TICKS);
  const slot = plotWidth / rows.length;
  const barWidth = Math.min(40, slot * 0.55);
  const showYear = rows.length > 12 || new Set(rows.map((r) => r.month.slice(0, 4))).size > 1;
  // Thin the month labels out when there are many.
  const labelEvery = Math.ceil(rows.length / 12);

  const points = rows.map((r, i) => ({
    x: PAD_LEFT + slot * i + slot / 2,
    barY: baseY - (r.total / amountMax) * plotHeight,
    lineY: baseY - (r.count / countMax) * plotHeight,
    r,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${animated ? p.lineY : baseY}`).join(' ');

  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0);
  const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
  const peak = rows.reduce((best, r) => (r.total > best.total ? r : best), rows[0]);
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const hover = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverPrev = hoverIndex !== null && hoverIndex > 0 ? rows[hoverIndex - 1] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Stat label={amountLabel} value={formatCurrency(totalAmount)} />
        <Stat label="Transactions" value={String(totalCount)} />
        <Stat label="Avg / Month" value={formatCurrency(totalAmount / rows.length)} />
        <Stat label="Peak Month" value={monthLabel(peak.month)} sub={formatCurrency(peak.total)} />
        {prev && (
          <Stat
            label={`${monthLabel(last.month)} vs ${monthLabel(prev.month)}`}
            value={<Change pct={changePct(last.total, prev.total)} />}
            sub={
              <>
                Transactions <Change pct={changePct(last.count, prev.count)} />
              </>
            }
          />
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: AMOUNT_COLOR }} /> Total amount (left axis)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: COUNT_COLOR }} /> Transactions (right axis)
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }} onMouseLeave={() => setHoverIndex(null)}>
          <defs>
            <linearGradient id="expense-trend-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={AMOUNT_COLOR} stopOpacity="0.95" />
              <stop offset="100%" stopColor={AMOUNT_COLOR} stopOpacity="0.35" />
            </linearGradient>
          </defs>

          {Array.from({ length: TICKS + 1 }, (_, t) => {
            const y = baseY - (t / TICKS) * plotHeight;
            return (
              <g key={t}>
                <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : '3 4'} opacity={t === 0 ? 1 : 0.7} />
                <text x={PAD_LEFT - 8} y={y + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">
                  {formatCompactCurrency((amountMax * t) / TICKS)}
                </text>
                <text x={WIDTH - PAD_RIGHT + 8} y={y + 4} textAnchor="start" fontSize="10.5" fill={COUNT_COLOR}>
                  {Math.round((countMax * t) / TICKS)}
                </text>
              </g>
            );
          })}

          {points.map(({ x, barY, r }, i) => {
            const barHeight = animated ? baseY - barY : 0;
            const isHover = hoverIndex === i;
            return (
              <g key={r.month} onMouseEnter={() => setHoverIndex(i)}>
                {isHover && <rect x={x - slot / 2} y={PAD_TOP} width={slot} height={plotHeight} fill="var(--surface-2)" opacity={0.6} />}
                <rect
                  x={x - barWidth / 2}
                  y={baseY - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={4}
                  fill="url(#expense-trend-bar)"
                  opacity={isHover || hoverIndex === null ? 1 : 0.55}
                  style={{ transition: 'height 0.7s cubic-bezier(0.16,1,0.3,1), y 0.7s cubic-bezier(0.16,1,0.3,1), opacity 0.15s ease', transitionDelay: `${i * 35}ms` }}
                />
                {i % labelEvery === 0 && (
                  <text x={x} y={HEIGHT - 8} textAnchor="middle" fontSize="11" fill={isHover ? 'var(--text)' : 'var(--muted)'} fontWeight={isHover ? 600 : 400}>
                    {monthLabel(r.month, showYear)}
                  </text>
                )}
                {/* full-height hit area so the whole month column reacts, even where the bar is short */}
                <rect x={x - slot / 2} y={PAD_TOP} width={slot} height={plotHeight} fill="transparent" />
              </g>
            );
          })}

          <path d={linePath} fill="none" stroke={COUNT_COLOR} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" style={{ pointerEvents: 'none' }} />
          {points.map(({ x, lineY, r }, i) => (
            <circle
              key={`dot-${r.month}`}
              cx={x}
              cy={animated ? lineY : baseY}
              r={hoverIndex === i ? 5.5 : 3.5}
              fill="var(--bg, #0f1117)"
              stroke={COUNT_COLOR}
              strokeWidth={2}
              style={{ transition: 'cy 0.7s cubic-bezier(0.16,1,0.3,1), r 0.15s ease', pointerEvents: 'none' }}
            />
          ))}
        </svg>

        {hover && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${(hover.x / WIDTH) * 100}%`,
              transform: `translateX(${hover.x / WIDTH > 0.7 ? '-105%' : '5%'})`,
              pointerEvents: 'none',
              background: 'var(--surface, #171922)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              boxShadow: 'var(--shadow-md)',
              whiteSpace: 'nowrap',
              zIndex: 2,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{monthLabel(hover.r.month)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: AMOUNT_COLOR }} />
              {formatCurrency(hover.r.total)}
              {hoverPrev && <Change pct={changePct(hover.r.total, hoverPrev.total)} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: COUNT_COLOR }} />
              {hover.r.count} transaction{hover.r.count === 1 ? '' : 's'}
              {hoverPrev && <Change pct={changePct(hover.r.count, hoverPrev.count)} />}
            </div>
            {hover.r.count > 0 && (
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>Avg {formatCurrency(hover.r.total / hover.r.count)} / transaction</div>
            )}
            {hoverPrev && <div style={{ color: 'var(--muted)', fontSize: 11 }}>% vs {monthLabel(hoverPrev.month)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 130px', padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}
