'use client';

import { Fragment, ReactNode, useState } from 'react';
import DepartmentExpenseChart from '@/components/DepartmentExpenseChart';
import DonutChart from '@/components/DonutChart';
import Modal from '@/components/Modal';

export interface GroupDetailRow {
  id: string;
  name: string;
  /** Small muted line under the name, e.g. the PIC (top contributing Sales). */
  subtitle?: string;
  totalExpense: number;
  transactionCount: number;
}

const COLORS = ['#8b7bfb', '#ef5da8', '#3fd085', '#f7b955', '#5ec8f2', '#ff8a5c', '#c68bff', '#4fd1c5'];
// The chart stays readable up to roughly this many entries; the table below always lists every one.
const CHART_LIMIT = 15;

// Past the fixed palette, spread extra hues around the wheel so every slice stays distinguishable.
const sliceColor = (i: number) => (i < COLORS.length ? COLORS[i] : `hsl(${Math.round((i * 137.5) % 360)} 65% 60%)`);

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(0)}Jt`;
  if (abs >= 1_000) return `Rp${(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

// "More" popup of a Top-5 dashboard card: a longer chart of the same ranking plus a detail table
// (rank, PIC, transactions, total, share) of every row.
export default function GroupDetailModal({
  title,
  rows,
  chart,
  centerLabel = 'Total Expense',
  showPic = true,
  legendBelow = false,
  legendHoverOnly = false,
  showAll = false,
  renderExpanded,
  onClose,
}: {
  title: string;
  rows: GroupDetailRow[];
  chart: 'bar' | 'donut';
  centerLabel?: string;
  /** false drops the PIC subtitle/column (the Agency card has none). */
  showPic?: boolean;
  /** Donut legend (names + values) under the chart instead of beside it. */
  legendBelow?: boolean;
  /** Donut shows no hovered name; the hovered legend row grows and brightens instead. */
  legendHoverOnly?: boolean;
  /** Chart every row instead of only the top CHART_LIMIT. */
  showAll?: boolean;
  /** When set, Detail rows are clickable: the clicked row opens this content right below it, and any other open row closes. */
  renderExpanded?: (row: GroupDetailRow) => ReactNode;
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sorted = [...rows].sort((a, b) => Number(b.totalExpense) - Number(a.totalExpense));
  const grandTotal = sorted.reduce((sum, r) => sum + Number(r.totalExpense), 0) || 1;
  const chartRows = showAll ? sorted : sorted.slice(0, CHART_LIMIT);

  return (
    <Modal title={title} onClose={onClose} wide>
      {sorted.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>No data</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            {sorted.length > chartRows.length && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Chart shows the top {chartRows.length} of {sorted.length}; the table below lists all.
              </div>
            )}
            {chart === 'bar' ? (
              <DepartmentExpenseChart data={chartRows} />
            ) : (
              <DonutChart
                data={chartRows.map((r, i) => ({
                  id: r.id,
                  label: r.name,
                  subtitle: showPic ? r.subtitle : undefined,
                  value: Number(r.totalExpense),
                  color: sliceColor(i),
                }))}
                centerLabel={centerLabel}
                legendBelow={legendBelow}
                legendHoverOnly={legendHoverOnly}
                formatValue={formatCompactCurrency}
              />
            )}
          </div>

          <div>
            <h3 style={{ marginTop: 0 }}>Detail ({sorted.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  {showPic && <th>PIC</th>}
                  <th style={{ textAlign: 'right' }}>Transactions</th>
                  <th style={{ textAlign: 'right' }}>Total Expense</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const open = !!renderExpanded && expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={renderExpanded ? () => setExpandedId(open ? null : r.id) : undefined}
                        style={renderExpanded ? { cursor: 'pointer', background: open ? 'rgba(127,127,127,0.12)' : undefined } : undefined}
                        aria-expanded={renderExpanded ? open : undefined}
                      >
                        <td>{i + 1}</td>
                        <td>
                          {renderExpanded && (
                            <span aria-hidden="true" style={{ display: 'inline-block', width: 14, color: 'var(--muted)' }}>
                              {open ? '▾' : '▸'}
                            </span>
                          )}
                          {r.name}
                        </td>
                        {showPic && <td>{r.subtitle ?? '-'}</td>}
                        <td style={{ textAlign: 'right' }}>{r.transactionCount}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(Number(r.totalExpense))}</td>
                        <td style={{ textAlign: 'right' }}>{((Number(r.totalExpense) / grandTotal) * 100).toFixed(1)}%</td>
                      </tr>
                      {open && renderExpanded && (
                        <tr>
                          <td colSpan={showPic ? 6 : 5} style={{ padding: '8px 12px 14px' }}>
                            {renderExpanded(r)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
