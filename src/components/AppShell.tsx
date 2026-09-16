'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useAutoMatch } from '@/lib/autoMatch';
import { useIdleLogout } from '@/lib/useIdleLogout';
import { getTheme, toggleTheme, Theme } from '@/lib/theme';
import { NavIcon } from './NavIcons';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: string[];
  permissions?: string[];
}

interface NavGroup {
  section: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    section: 'Dashboard',
    items: [
      {
        href: '/dashboard/executive',
        label: 'Executive Dashboard',
        icon: 'dashboard',
        roles: ['ADMIN', 'FINANCE', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept'],
      },
      {
        href: '/expense-dashboard',
        label: 'Expense Dashboard',
        icon: 'dashboard',
        roles: ['ADMIN', 'FINANCE', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept'],
      },
      {
        href: '/dashboard/settlement',
        label: 'Settlement Dashboard',
        icon: 'dashboard',
        roles: ['ADMIN', 'FINANCE', 'MANAGEMENT'],
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
        roles: ['ADMIN', 'FINANCE', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept'],
      },
      { href: '/audit-logs', label: 'Audit Log', icon: 'audit-log', roles: ['ADMIN', 'FINANCE'] },
      {
        href: '/dashboard/audit-report',
        label: 'Audit Report',
        icon: 'audit-log',
        roles: ['ADMIN', 'FINANCE', 'MANAGEMENT'],
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
        roles: ['SUPERVISOR', 'MANAGEMENT', 'FINANCE'],
        permissions: ['expense.approve.all', 'expense.approve.owndept'],
      },
      {
        href: '/settlement',
        label: 'Settlement',
        icon: 'settlement',
        roles: ['ADMIN', 'FINANCE'],
        permissions: ['settlement.create.owndept', 'settlement.read.owndept', 'settlement.read.all'],
      },
    ],
  },
  {
    section: 'Master',
    items: [
      { href: '/master/units', label: 'Unit', icon: 'unit', roles: ['ADMIN'] },
      { href: '/master/departments', label: 'Department', icon: 'department', roles: ['ADMIN'] },
      { href: '/master/positions', label: 'Position', icon: 'position', roles: ['ADMIN'] },
      { href: '/master/agencies', label: 'Agency', icon: 'agency', roles: ['ADMIN'] },
      { href: '/master/advertisers', label: 'Advertiser', icon: 'advertiser', roles: ['ADMIN'] },
      { href: '/master/brands', label: 'Brand', icon: 'brand', roles: ['ADMIN'] },
      { href: '/master/activity-types', label: 'Activity Type', icon: 'activity-type', roles: ['ADMIN'] },
      { href: '/master/credit-cards', label: 'Corporate Card', icon: 'credit-card', roles: ['ADMIN'] },
      { href: '/master/payment-methods', label: 'Payment Method', icon: 'payment-method', roles: ['ADMIN'] },
      { href: '/master/roles', label: 'Role', icon: 'role', roles: ['ADMIN'] },
      { href: '/master/permissions', label: 'Permission', icon: 'permission', roles: ['ADMIN'] },
    ],
  },
  {
    section: 'Import',
    items: [{ href: '/import', label: 'Excel/CSV/PDF', icon: 'import', roles: ['ADMIN', 'FINANCE'] }],
  },
  {
    section: 'System',
    items: [
      { href: '/users', label: 'User', icon: 'user', roles: ['ADMIN'] },
      { href: '/approval-levels', label: 'Approval Level', icon: 'approval-level', roles: ['ADMIN'] },
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

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    setThemeState(getTheme());
    setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useIdleLogout(!!user, logout);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  if (loading) return <div className="content">Loading...</div>;
  if (!user) return null;

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
            const visibleItems = group.items.filter(
              (item) =>
                item.roles.length === 0 || hasRole(...item.roles) || hasPermission(...(item.permissions ?? [])),
            );
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
          <div style={{ background: 'var(--border)', height: 6, borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
                height: 6,
                background: 'var(--primary, #4f7cff)',
                borderRadius: 3,
                transition: 'width .3s',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
