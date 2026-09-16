'use client';

import { useEffect, useRef, useState } from 'react';

interface ProgressRow {
  level: number;
  positionName: string;
  approvedPct: number;
  waitingPct: number;
  rejectedPct: number;
}

export default function ApprovalProgressBar({ data }: { data: ProgressRow[] }) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {data.map((row) => (
        <div key={row.level}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Level {row.level}
            <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>{row.positionName}</span>
          </div>
          <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }}>
            {row.approvedPct > 0 && (
              <div
                style={{
                  width: animated ? `${row.approvedPct}%` : 0,
                  background: '#3fd085',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#0a2e1c',
                  transition: 'width 0.7s cubic-bezier(0.16,1,0.3,1)',
                }}
              >
                {row.approvedPct >= 8 ? `${row.approvedPct}%` : ''}
              </div>
            )}
            {row.waitingPct > 0 && (
              <div
                style={{
                  width: animated ? `${row.waitingPct}%` : 0,
                  background: '#f7b955',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#3a2a05',
                  transition: 'width 0.7s cubic-bezier(0.16,1,0.3,1)',
                  transitionDelay: '60ms',
                }}
              >
                {row.waitingPct >= 8 ? `${row.waitingPct}%` : ''}
              </div>
            )}
            {row.rejectedPct > 0 && (
              <div
                style={{
                  width: animated ? `${row.rejectedPct}%` : 0,
                  background: '#ef5da8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#3a0a1f',
                  transition: 'width 0.7s cubic-bezier(0.16,1,0.3,1)',
                  transitionDelay: '120ms',
                }}
              >
                {row.rejectedPct >= 8 ? `${row.rejectedPct}%` : ''}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
