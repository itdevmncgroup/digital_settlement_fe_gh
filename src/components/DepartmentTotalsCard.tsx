'use client';

import RankedBarList from '@/components/RankedBarList';
import { formatCompactCurrency } from '@/lib/mobileUi';

export interface DepartmentTotal {
  id: string;
  name: string;
  count: number;
  totalAmount: string | number;
}

const COLORS = ['#8b7bfb', '#ef5da8', '#3fd085', '#f7b955', '#5ec8f2', '#ff8a5c', '#c68bff', '#4fd1c5'];

// Mobile dashboard chart: total Expense amount per Department of the logged-in user.
// The API only fills `byDepartment` when the user has more than one Department, so an
// empty/short list renders nothing.
export default function DepartmentTotalsCard({ data, title = 'Expense per department' }: { data?: DepartmentTotal[]; title?: string }) {
  if (!data || data.length < 2) return null;
  return (
    <>
      <div className="m-section-title">{title}</div>
      <div className="m-item" style={{ display: 'block' }}>
        <RankedBarList
          data={data.map((d, i) => ({
            id: d.id,
            name: d.name,
            value: Number(d.totalAmount),
            color: COLORS[i % COLORS.length],
            displayValue: `${formatCompactCurrency(d.totalAmount)} · ${d.count} expense(s)`,
          }))}
        />
      </div>
    </>
  );
}
