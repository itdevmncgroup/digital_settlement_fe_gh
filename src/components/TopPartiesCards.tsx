'use client';

import RankedBarList from '@/components/RankedBarList';
import { formatCompactCurrency } from '@/lib/mobileUi';

export interface TopPartyRow {
  id: string;
  name: string;
  count: number;
  totalAmount: string | number;
}

export interface TopParties {
  agencies: TopPartyRow[];
  advertisers: TopPartyRow[];
}

const COLORS = ['#8b7bfb', '#ef5da8', '#3fd085', '#f7b955', '#5ec8f2'];

function Card({ title, rows }: { title: string; rows: TopPartyRow[] }) {
  return (
    <>
      <div className="m-section-title">{title}</div>
      <div className="m-item" style={{ display: 'block' }}>
        <RankedBarList
          data={rows.map((r, i) => ({
            id: r.id,
            name: r.name,
            value: Number(r.totalAmount),
            color: COLORS[i % COLORS.length],
            displayValue: `${formatCompactCurrency(r.totalAmount)} · ${r.count} expense(s)`,
          }))}
        />
      </div>
    </>
  );
}

// Mobile dashboard charts: Top 5 Agency and Top 5 Advertiser by Expense amount, over the same scope as the
// dashboard's other numbers. Renders nothing when the API sent no data (older backend) or there is none yet.
export default function TopPartiesCards({ data, suffix }: { data?: TopParties; suffix?: string }) {
  if (!data) return null;
  const tail = suffix ? ` · ${suffix}` : '';
  return (
    <>
      {data.agencies.length > 0 && <Card title={`Top 5 Agency${tail}`} rows={data.agencies} />}
      {data.advertisers.length > 0 && <Card title={`Top 5 Advertiser${tail}`} rows={data.advertisers} />}
    </>
  );
}
