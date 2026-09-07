'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
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
  { section: 'Dashboard', items: [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['ADMIN', 'FINANCE', 'MANAGEMENT'] }] },
  {
    section: 'Transaction',
    items: [
      { href: '/expenses', label: 'All Expenses', icon: 'expenses', roles: [] },
      {
        href: '/approvals',
        label: 'Approval',
        icon: 'approval',
        roles: ['SUPERVISOR', 'MANAGEMENT', 'FINANCE'],
        permissions: ['expense.approve.all', 'expense.approve.ownpod'],
      },
      {
        href: '/settlement',
        label: 'Settlement',
        icon: 'settlement',
        roles: ['ADMIN', 'FINANCE'],
        permissions: ['settlement.create.ownpod', 'settlement.read.ownpod', 'settlement.read.all'],
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
      { href: '/master/credit-cards', label: 'Credit Card', icon: 'credit-card', roles: ['ADMIN'] },
      { href: '/master/roles', label: 'Role', icon: 'role', roles: ['ADMIN'] },
      { href: '/master/permissions', label: 'Permission', icon: 'permission', roles: ['ADMIN'] },
      { href: '/pods', label: 'POD', icon: 'pod', roles: ['ADMIN'] },
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
      { href: '/audit-logs', label: 'Audit Log', icon: 'audit-log', roles: ['ADMIN', 'FINANCE'] },
    ],
  },
];

const SIDEBAR_STORAGE_KEY = 'sidebarCollapsed';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout, hasRole, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [theme, setThemeState] = useState<Theme>('dark');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setThemeState(getTheme());
    setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  if (loading) return <div className="content">Loading...</div>;
  if (!user) return null;

  return (
    <div className="shell">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark"><NavIcon name="logo" /></span>
            {!collapsed && <span className="gradient-text">Digital Settlement</span>}
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
                    className={pathname?.startsWith(item.href) ? 'active' : ''}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="nav-icon"><NavIcon name={item.icon} /></span>
                    {!collapsed && <span className="nav-label">{item.label}</span>}
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
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
            <button className="btn" onClick={logout}>
              Logout
            </button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
