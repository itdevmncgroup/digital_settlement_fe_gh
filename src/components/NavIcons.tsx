import { ReactNode } from 'react';

/* Flat, single-stroke (currentColor) outline icons for the sidebar nav.
   Keyed by short slug used in AppShell's NAV array. `logo` is the app
   brand-mark glyph shown on the gradient tile in the sidebar header
   (kept as a separate key from `brand`, which is the "Brand" master-data
   nav item, to avoid a naming collision). */
const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </>
  ),
  expenses: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="10" y2="9" />
    </>
  ),
  approval: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <polyline points="8 12.5 11 15.5 16.5 9" />
    </>
  ),
  settlement: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </>
  ),
  unit: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <rect x="7" y="6" width="3" height="3" rx="0.5" />
      <rect x="14" y="6" width="3" height="3" rx="0.5" />
      <rect x="7" y="12" width="3" height="3" rx="0.5" />
      <rect x="14" y="12" width="3" height="3" rx="0.5" />
      <rect x="10" y="18" width="4" height="4" />
    </>
  ),
  department: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  position: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <line x1="2" y1="13" x2="22" y2="13" />
    </>
  ),
  agency: (
    <>
      <circle cx="8" cy="12" r="5" />
      <circle cx="16" cy="12" r="5" />
    </>
  ),
  advertiser: (
    <>
      <path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z" />
      <path d="M16 8.5a3.5 3.5 0 0 1 0 7" />
      <path d="M19 5.5a7.5 7.5 0 0 1 0 13" />
    </>
  ),
  brand: (
    <>
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
  'activity-type': (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  'credit-card': (
    <>
      <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" />
      <path d="M4 6v12a2 2 0 0 0 2 2h14v-6" />
      <path d="M18 12h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-2a2 2 0 0 1 0-4z" />
    </>
  ),
  role: <path d="M12 2 3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6z" />,
  permission: (
    <>
      <circle cx="8" cy="15" r="4" />
      <line x1="10.5" y1="12.5" x2="20" y2="3" />
      <line x1="16" y1="7" x2="19" y2="10" />
      <line x1="19" y1="4" x2="22" y2="7" />
    </>
  ),
  import: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  user: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  'approval-level': (
    <>
      <polyline points="7 6 12 11 17 6" />
      <polyline points="7 12 12 17 17 12" />
    </>
  ),
  'audit-log': (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5.5" />
      <polyline points="14 2 14 8 20 8" />
      <circle cx="17" cy="17" r="4" />
      <polyline points="17 15.5 17 17 18.3 17.6" />
    </>
  ),
  logo: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <line x1="12" y1="1.5" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22.5" />
      <line x1="4.2" y1="4.2" x2="5.9" y2="5.9" />
      <line x1="18.1" y1="18.1" x2="19.8" y2="19.8" />
      <line x1="1.5" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22.5" y2="12" />
      <line x1="4.2" y1="19.8" x2="5.9" y2="18.1" />
      <line x1="18.1" y1="5.9" x2="19.8" y2="4.2" />
    </>
  ),
  moon: <path d="M20.5 14.6A8.5 8.5 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="21" y1="21" x2="15.4" y2="15.4" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
};

export function NavIcon({ name }: { name: string }) {
  const path = ICONS[name];
  if (!path) return null;
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}
