import Link from 'next/link';
import { CSSProperties, ReactNode } from 'react';
import { NavIcon } from '@/components/NavIcons';

export function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

// Compact form for big totals in tight tiles: 1,2 jt / 3,4 M.
export function formatCompactCurrency(value: string | number) {
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `Rp ${(n / 1e9).toFixed(1).replace('.', ',')} M`;
  if (abs >= 1e6) return `Rp ${(n / 1e6).toFixed(1).replace('.', ',')} jt`;
  return formatCurrency(n);
}

export type Tone = 'success' | 'danger' | 'warning' | 'info';

export function statusTone(status: string): Tone {
  if (status === 'COMPLETE' || status === 'SETTLED' || status === 'READY_TO_MATCHING' || status === 'READY_TO_SETTLED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING_APPROVAL' || status.startsWith('APPROVAL_')) return 'warning';
  return 'info';
}

export const TONE_COLOR: Record<Tone, string> = {
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--primary)',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${statusTone(status)}`}>{status.replace(/_/g, ' ')}</span>;
}

export function toneStyle(tone: string): CSSProperties {
  return { ['--tone' as string]: tone };
}

// Stat tile with an icon chip; renders as a link when `href` is given.
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'var(--primary)',
  wide,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: string;
  tone?: string;
  wide?: boolean;
  href?: string;
}) {
  const className = `m-stat${wide ? ' wide' : ''}`;
  const body = (
    <>
      <div className="m-stat-icon" style={toneStyle(tone)}>
        <NavIcon name={icon} />
      </div>
      <div className="m-stat-label">{label}</div>
      <div className="m-stat-value">{value}</div>
      {sub && <div className="m-stat-sub">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="m-skeleton" />
      ))}
    </>
  );
}
