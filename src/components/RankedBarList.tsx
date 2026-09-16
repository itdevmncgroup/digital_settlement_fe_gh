'use client';

import { useEffect, useRef, useState } from 'react';

interface RankedBarRow {
  id: string;
  name: string;
  value: number;
  color: string;
  displayValue: string;
}

// Horizontal ranked bar list with a per-row color (compliance score bands,
// findings-by-type, settlement aging) - unlike SimpleBarChart/StatusBreakdownChart,
// the color and the right-side label are fully caller-controlled per row.
export default function RankedBarList({ data }: { data: RankedBarRow[] }) {
  const [animated, setAnimated] = useState(false);
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

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map((row, i) => {
        const widthPct = animated ? (Math.abs(row.value) / max) * 100 : 0;
        return (
          <div key={row.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{row.name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>{row.displayValue}</span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 10,
                borderRadius: 999,
                background: 'var(--surface-2)',
                overflow: 'hidden',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${widthPct}%`,
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${row.color}, color-mix(in srgb, ${row.color} 60%, white))`,
                  boxShadow: `0 0 6px color-mix(in srgb, ${row.color} 50%, transparent)`,
                  transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                  transitionDelay: `${i * 60}ms`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
