'use client';

import { useEffect, useRef, useState } from 'react';

interface StatusRow {
  key: string;
  label: string;
  count: number;
  color: string;
}

export default function StatusBreakdownChart({ data }: { data: StatusRow[] }) {
  const [animated, setAnimated] = useState(false);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    setAnimated(false);
    raf.current = requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [data]);

  const total = data.reduce((sum, r) => sum + r.count, 0) || 1;
  const max = Math.max(...data.map((r) => r.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map((row, i) => {
        const pct = (row.count / total) * 100;
        const widthPct = animated ? (row.count / max) * 100 : 0;
        return (
          <div key={row.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: row.color, boxShadow: `0 0 8px ${row.color}` }} />
                {row.label}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>
                {row.count} <span style={{ opacity: 0.7 }}>· {pct.toFixed(1)}%</span>
              </span>
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
