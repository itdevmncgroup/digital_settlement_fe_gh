'use client';

import Link from 'next/link';

export interface PillTab<K extends string> {
  key: K;
  label: string;
  // Shown as a small badge next to the label.
  count?: number;
  // Set for route-based tabs (each tab is its own page); otherwise the tab is a button driven by onChange.
  href?: string;
}

// Segmented "pill" tab bar shared by the Approval and Transaction > Flower Bouquet pages.
export default function PillTabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: PillTab<K>[];
  active: K;
  onChange?: (key: K) => void;
}) {
  return (
    <div className="pill-tabs" role="tablist">
      {tabs.map((t) => {
        const isActive = t.key === active;
        const className = `pill-tab${isActive ? ' active' : ''}`;
        const content = (
          <>
            {t.label}
            {t.count !== undefined && <span className="pill-tab-count">{t.count}</span>}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} className={className} role="tab" aria-selected={isActive} aria-current={isActive ? 'page' : undefined}>
            {content}
          </Link>
        ) : (
          <button key={t.key} type="button" className={className} role="tab" aria-selected={isActive} onClick={() => onChange?.(t.key)}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
