'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useAutoMatch } from '@/lib/autoMatch';
import { useIdleLogout } from '@/lib/useIdleLogout';
import { getTheme, toggleTheme, Theme } from '@/lib/theme';
import { NavIcon } from './NavIcons';
import SplashLoader from './SplashLoader';
import { positionMatches } from '@/lib/position';
import { resolveViewMode, ViewMode, VIEW_STORAGE_KEY } from '@/lib/viewMode';

interface NavItem {
  href: string;
  label: string;
  // Shorter text for the bottom tab bar (falls back to label).
  tabLabel?: string;
  icon: string;
  roles: string[];
  permissions?: string[];
  // When set, only users whose Position.code is listed see the item.
  positions?: string[];
  // Position codes that never see the item (e.g. the generic dashboard for Head POD / CO-CSO, who have their own).
  hidePositions?: string[];
  hideRoles?: string[];
}

interface NavGroup {
  section: string;
  items: NavItem[];
}

// Phone-friendly pages under /m. Shown as a sidebar group for everyone allowed,
// and as the bottom tab bar in Mobile View.
const MOBILE_NAV: NavItem[] = [
  {
    href: '/m/dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    roles: [],
    hidePositions: ['HEAD_POD', 'CO-CSO'],
    hideRoles: ['MANAGEMENT'],
  },
  {
    href: '/m/dashboard-head-dept',
    label: 'Dashboard Head Dept',
    tabLabel: 'Dashboard',
    icon: 'dashboard',
    roles: [],
    positions: ['HEAD_POD'],
  },
  {
    href: '/m/dashboard-co-cso',
    label: 'Dashboard CO-CSO',
    tabLabel: 'Dashboard',
    icon: 'dashboard',
    roles: [],
    positions: ['CO-CSO'],
  },
  {
    href: '/m/dashboard-management',
    label: 'Dashboard Management',
    tabLabel: 'Dashboard',
    icon: 'dashboard',
    roles: ['MANAGEMENT'],
  },
  {
    href: '/m/expense/new',
    label: 'New Expense',
    icon: 'plus',
    roles: ['SALES'],
    permissions: ['expense.create.all', 'expense.create.owndept'],
  },
  { href: '/m/expenses', label: 'Expenses', icon: 'expenses', roles: [], hideRoles: ['MANAGEMENT'] },
  {
    href: '/m/settlement',
    label: 'Settlement',
    icon: 'settlement',
    roles: ['ADMINISTRATOR'],
    permissions: ['settlement.read.owndept', 'settlement.read.all'],
  },
  {
    href: '/m/approvals',
    label: 'Approval',
    icon: 'approval',
    roles: ['ADMINISTRATOR', 'MANAGEMENT'],
    permissions: ['expense.approve.all', 'expense.approve.owndept'],
  },
  { href: '/m/profile', label: 'Profile', icon: 'user', roles: [] },
];

const NAV: NavGroup[] = [
  { section: 'Web Mobile', items: MOBILE_NAV },
  {
    section: 'Dashboard',
    items: [
      {
        href: '/dashboard/executive',
        label: 'Executive Dashboard',
        icon: 'dashboard',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept'],
      },
      {
        href: '/expense-dashboard',
        label: 'Expense Dashboard',
        icon: 'dashboard',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept'],
      },
      {
        href: '/dashboard/settlement',
        label: 'Settlement Dashboard',
        icon: 'dashboard',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept'],
      },
    ],
  },
  {
    section: 'Reporting',
    items: [
      {
        href: '/dashboard/expense-analytics',
        label: 'Expense Analytics',
        icon: 'dashboard',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept'],
      },
      { href: '/audit-logs', label: 'Audit Log', icon: 'audit-log', roles: ['ADMINISTRATOR'] },
      {
        href: '/dashboard/audit-report',
        label: 'Audit Report',
        icon: 'audit-log',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['audit-report.read.all', 'audit-report.read.owndept'],
      },
    ],
  },
  {
    section: 'Transaction',
    items: [
      { href: '/expenses', label: 'All Expenses', icon: 'expenses', roles: [] },
      {
        href: '/approvals',
        label: 'Approval',
        icon: 'approval',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['expense.approve.all', 'expense.approve.owndept'],
      },
      {
        href: '/settlement',
        label: 'Settlement',
        icon: 'settlement',
        roles: ['ADMINISTRATOR'],
        permissions: ['settlement.create.owndept', 'settlement.read.owndept', 'settlement.read.all'],
      },
    ],
  },
  {
    section: 'Master',
    items: [
      { href: '/master/units', label: 'Unit', icon: 'unit', roles: ['ADMINISTRATOR'] },
      { href: '/master/departments', label: 'Department', icon: 'department', roles: ['ADMINISTRATOR'] },
      { href: '/master/positions', label: 'Position', icon: 'position', roles: ['ADMINISTRATOR'] },
      { href: '/master/agencies', label: 'Agency', icon: 'agency', roles: ['ADMINISTRATOR'] },
      { href: '/master/advertisers', label: 'Advertiser', icon: 'advertiser', roles: ['ADMINISTRATOR'] },
      { href: '/master/brands', label: 'Brand', icon: 'brand', roles: ['ADMINISTRATOR'] },
      { href: '/master/activity-types', label: 'Activity Type', icon: 'activity-type', roles: ['ADMINISTRATOR'] },
      { href: '/master/credit-cards', label: 'Corporate Card', icon: 'credit-card', roles: ['ADMINISTRATOR'] },
      { href: '/master/payment-methods', label: 'Payment Method', icon: 'payment-method', roles: ['ADMINISTRATOR'] },
      { href: '/master/roles', label: 'Role', icon: 'role', roles: ['ADMINISTRATOR'] },
      { href: '/master/permissions', label: 'Permission', icon: 'permission', roles: ['ADMINISTRATOR'] },
    ],
  },
  {
    section: 'Import',
    items: [{ href: '/import', label: 'Excel/CSV/PDF', icon: 'import', roles: ['ADMINISTRATOR'] }],
  },
  {
    section: 'System',
    items: [
      { href: '/users', label: 'User', icon: 'user', roles: ['ADMINISTRATOR'] },
      { href: '/approval-levels', label: 'Approval Level', icon: 'approval-level', roles: ['ADMINISTRATOR'] },
    ],
  },
];

const SIDEBAR_STORAGE_KEY = 'sidebarCollapsed';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout, hasRole, hasPermission } = useAuth();
  const { running, progress } = useAutoMatch();
  const router = useRouter();
  const pathname = usePathname();

  // Longest-href-wins: picks whichever nav item's href best matches the
  // current path, so sibling routes that happen to share a prefix (e.g.
  // /dashboard vs /dashboard/executive) don't all light up together.
  const activeHref = NAV.flatMap((g) => g.items)
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname?.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  const [theme, setThemeState] = useState<Theme>('light');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewMode, setViewModeState] = useState<ViewMode | null>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    setThemeState(getTheme());
    setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
    setViewModeState(resolveViewMode());
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useIdleLogout(!!user, logout);

  const setViewMode = (mode: ViewMode) => {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
    setViewModeState(mode);
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  if (loading) return <SplashLoader message="Loading" />;
  if (!user) return null;

  const isVisible = (item: NavItem) =>
    item.hidePositions?.some((c) => positionMatches(user.position?.code, c)) || (item.hideRoles && hasRole(...item.hideRoles))
      ? false
      : item.positions
      ? item.positions.some((c) => positionMatches(user.position?.code, c))
      : (item.roles.length === 0 && !item.permissions) || hasRole(...item.roles) || hasPermission(...(item.permissions ?? []));

  // Sales is always the phone layout (bottom tab bar, no sidebar). Everyone else
  // picks Mobile or Desktop View; the default follows the device they opened it on.
  const canChooseView = !hasRole('SALES');
  if (canChooseView && !viewMode) return <SplashLoader message="Preparing your workspace" />;
  const bottomNav = !canChooseView || viewMode === 'mobile';
  const tabs = MOBILE_NAV.filter(isVisible);

  if (bottomNav) {
    return (
      <div className="mobile-shell">
        <header className="mobile-topbar">
          <div className="mobile-brand">
            <span className="mobile-brand-mark"><NavIcon name="logo" /></span>
            <div className="mobile-brand-text">
              <strong>{user.name}</strong>
              <span>{user.position?.name ?? user.roles.join(', ')}</span>
            </div>
          </div>
          <div className="mobile-actions">
            {canChooseView && (
              <button className="pill-btn" onClick={() => setViewMode('desktop')}>
                Desktop
              </button>
            )}
            <button
              className="pill-btn"
              onClick={() => setThemeState(toggleTheme())}
              aria-label="Toggle theme"
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              <NavIcon name={theme === 'dark' ? 'moon' : 'sun'} />
            </button>
          </div>
        </header>
        <main className="mobile-content">{children}</main>
        <nav className="bottom-nav" aria-label="Main">
          {tabs.map((item) => (
            <Link key={item.href} href={item.href} className={item.href === activeHref ? 'active' : ''}>
              <span className="nav-icon"><NavIcon name={item.icon} /></span>
              <span className="nav-label">{item.tabLabel ?? item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    );
  }

  // Desktop's collapsed (icon-only) preference shouldn't also hide labels
  // inside the mobile off-canvas panel, which is always shown full-width.
  const effectiveCollapsed = collapsed && !mobileOpen;

  return (
    <div className="shell">
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
      <aside className={`sidebar${effectiveCollapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark"><NavIcon name="logo" /></span>
            {!effectiveCollapsed && <span className="gradient-text">Digital Settlement</span>}
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        <nav>
          {NAV.map((group) => {
            const visibleItems = group.items.filter(isVisible);
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.section}>
                <div className="group-label">
                  <span>{group.section}</span>
                </div>
                {visibleItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={item.href === activeHref ? 'active' : ''}
                    title={effectiveCollapsed ? item.label : undefined}
                  >
                    <span className="nav-icon"><NavIcon name={item.icon} /></span>
                    {!effectiveCollapsed && <span className="nav-label">{item.label}</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <div>
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              title={mobileOpen ? 'Close menu' : 'Open menu'}
            >
              ☰
            </button>
            <strong>{user.name}</strong> <span className="badge">{user.roles.join(', ')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="theme-toggle"
              onClick={() => setThemeState(toggleTheme())}
              aria-label="Toggle theme"
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              <NavIcon name={theme === 'dark' ? 'moon' : 'sun'} />
              <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </button>
            {canChooseView && (
              <button className="btn" onClick={() => setViewMode('mobile')}>
                Mobile View
              </button>
            )}
            <button className="btn" onClick={logout}>
              Logout
            </button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
      {running && progress && (
        <div
          className="card"
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            width: 280,
            zIndex: 1000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Auto Match: file {progress.current + 1}/{progress.total}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {progress.fileName}
          </div>
          <div style={{ background: 'var(--border)', height: 6, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            {/* One file's parse/OCR can take a while with no sub-progress to
                report, so a static width-per-file bar sits motionless for most
                of a run and reads as stuck - this sweeps continuously instead,
                signalling "still working" rather than a literal percent. */}
            <div
              style={{
                width: '40%',
                height: 6,
                background: 'var(--primary, #4f7cff)',
                borderRadius: 3,
                animation: 'progress-indeterminate 1.1s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
