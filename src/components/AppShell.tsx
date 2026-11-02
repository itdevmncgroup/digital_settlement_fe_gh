'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useAutoMatch } from '@/lib/autoMatch';
import { useIdleLogout } from '@/lib/useIdleLogout';
import { getTheme, toggleTheme, Theme } from '@/lib/theme';
import { NavIcon } from './NavIcons';
import BrandLogo from './BrandLogo';
import SplashLoader from './SplashLoader';
import { positionMatches } from '@/lib/position';
import { resolveViewMode, ViewMode, VIEW_STORAGE_KEY } from '@/lib/viewMode';
import { loginUrlFor } from '@/lib/loginRedirect';

interface NavItem {
  href: string;
  label: string;
  // Shorter text for the bottom tab bar (falls back to label).
  tabLabel?: string;
  icon: string;
  // Desktop sidebar: hide the icon while the sidebar is expanded (the collapsed, icon-only sidebar still needs it).
  hideIconWhenExpanded?: boolean;
  roles: string[];
  permissions?: string[];
  // When set, only users whose Position.code is listed see the item.
  positions?: string[];
  // Position codes that never see the item (e.g. the generic dashboard for Head POD / CO-CSO, who have their own).
  hidePositions?: string[];
  hideRoles?: string[];
  // Extra gate on top of roles/positions: the user must also hold one of these (ADMINISTRATOR
  // exempt). Used by the Web Mobile dashboards - webmobile.dashboard.read.* decides who gets one.
  requirePermissions?: string[];
  // Other route prefixes that belong to this item, so it stays highlighted there (e.g. Flower Bouquet's Expense tab).
  alsoActive?: string[];
}

interface NavGroup {
  section: string;
  items: NavItem[];
  // Single top-level link: rendered as a plain menu item, with no collapsible group header.
  standalone?: boolean;
}

// Phone-friendly pages under /m. Shown as a sidebar group for everyone allowed,
// and as the bottom tab bar in Mobile View.
const MOBILE_DASHBOARD_PERMISSIONS = ['webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept'];

const MOBILE_NAV: NavItem[] = [
  {
    href: '/m/dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    roles: [],
    hidePositions: ['HEAD-POD', 'CO-CSO'],
    hideRoles: ['MANAGEMENT'],
    requirePermissions: MOBILE_DASHBOARD_PERMISSIONS,
  },
  {
    href: '/m/dashboard-head-dept',
    label: 'Dashboard Head Dept',
    tabLabel: 'Dashboard',
    icon: 'dashboard',
    roles: [],
    positions: ['HEAD-POD'],
    requirePermissions: MOBILE_DASHBOARD_PERMISSIONS,
  },
  {
    href: '/m/dashboard-co-cso',
    label: 'Dashboard CO-CSO',
    tabLabel: 'Dashboard',
    icon: 'dashboard',
    roles: [],
    positions: ['CO-CSO'],
    requirePermissions: MOBILE_DASHBOARD_PERMISSIONS,
  },
  {
    href: '/m/dashboard-management',
    label: 'Dashboard Management',
    tabLabel: 'Dashboard',
    icon: 'dashboard',
    roles: ['MANAGEMENT'],
    requirePermissions: MOBILE_DASHBOARD_PERMISSIONS,
  },
  {
    href: '/m/expense/new',
    label: 'New Expense',
    icon: 'plus',
    roles: ['ADMINISTRATOR'],
    permissions: ['webmobile.expense.create.own', 'webmobile.expense.create.owndept'],
  },
  {
    href: '/m/expenses',
    label: 'Expenses',
    icon: 'expenses',
    roles: ['ADMINISTRATOR'],
    permissions: ['webmobile.expense.read.own', 'webmobile.expense.read.owndept'],
  },
  {
    href: '/m/expense-requests',
    label: 'Request Expense',
    tabLabel: 'Request',
    icon: 'expenses',
    roles: ['ADMINISTRATOR'],
    permissions: ['webmobile.request.expense.read.own', 'webmobile.request.expense.read.owndept'],
  },
  {
    href: '/m/expense-requests/new',
    label: 'New Request',
    icon: 'plus',
    roles: ['ADMINISTRATOR'],
    permissions: ['webmobile.request.expense.create.own', 'webmobile.request.expense.create.owndept'],
  },
  {
    href: '/m/settlement',
    label: 'Settlement',
    icon: 'settlement',
    roles: ['ADMINISTRATOR'],
    permissions: ['webmobile.settlement.read.owndept'],
  },
  // Gated by webmobile.approval.read.* rather than a Role / expense.approve.*: who has something
  // pending here is a Position-resolved approver chain (ApprovalLevel) - e.g. CO-CSO never holds
  // ADMINISTRATOR/MANAGEMENT nor the override permissions, yet is a normal tier approver - so the
  // role defaults in prisma/seed.ts grant it to every approver role.
  {
    href: '/m/approvals',
    label: 'Approval',
    icon: 'approval',
    roles: ['ADMINISTRATOR'],
    permissions: ['webmobile.approval.read.own', 'webmobile.approval.read.owndept'],
  },
  {
    href: '/m/profile',
    label: 'Profile',
    icon: 'user',
    roles: ['ADMINISTRATOR'],
    permissions: ['webmobile.profile.read.own'],
  },
];

const NAV: NavGroup[] = [
  {
    section: 'Dashboard',
    items: [
      {
        href: '/expense-dashboard',
        label: 'Transaction Dashboard',
        icon: 'dashboard-transaction',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept', 'dashboard.expense.read.owndept'],
      },
      {
        href: '/dashboard/settlement',
        label: 'Settlement Dashboard',
        icon: 'dashboard-settlement',
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['dashboard.read.all', 'dashboard.read.owndept', 'dashboard.settlement.read.owndept'],
      },
    ],
  },
  {
    section: 'Transaction',
    items: [
      { href: '/expenses', label: 'Entertainment', icon: 'entertainment', roles: [] },
      // Tabs: Expense Request (this route) and Expense (/flower-bouquet/expenses).
      { href: '/expense-requests', label: 'Flower Bouquet', icon: 'flower', roles: [], alsoActive: ['/flower-bouquet'] },
    ],
  },
  {
    section: 'Settlement',
    items: [
      {
        href: '/settlement',
        label: 'Entertainment',
        icon: 'settlement',
        roles: ['ADMINISTRATOR'],
        permissions: ['settlement.create.owndept', 'settlement.read.owndept', 'settlement.read.all'],
      },
      {
        href: '/settlement/flower-bouquet',
        label: 'Flower Bouquet',
        icon: 'settlement',
        roles: ['ADMINISTRATOR'],
        permissions: ['settlement.create.owndept', 'settlement.read.owndept', 'settlement.read.all'],
      },
    ],
  },
  {
    section: 'Approval',
    standalone: true,
    items: [
      {
        href: '/approvals',
        label: 'APPROVAL',
        icon: 'approval',
        hideIconWhenExpanded: true,
        roles: ['ADMINISTRATOR', 'MANAGEMENT'],
        permissions: ['expense.approve.all', 'expense.approve.owndept', 'approval.read.own'],
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
      { href: '/users', label: 'User', icon: 'user', roles: ['ADMINISTRATOR'] },
      { href: '/master/roles', label: 'Role', icon: 'role', roles: ['ADMINISTRATOR'] },
      { href: '/master/permissions', label: 'Permission', icon: 'permission', roles: ['ADMINISTRATOR'] },
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
  { section: 'Web Mobile', items: MOBILE_NAV },
  {
    section: 'System',
    items: [
      { href: '/approval-levels', label: 'Approval Level', icon: 'approval-level', roles: ['ADMINISTRATOR'] },
      { href: '/approval-trail', label: 'Approval Trail', icon: 'approval', roles: ['ADMINISTRATOR'] },
      { href: '/rollback', label: 'Rollback', icon: 'rollback', roles: ['ADMINISTRATOR'] },
    ],
  },
];

const SIDEBAR_STORAGE_KEY = 'sidebarCollapsed';

function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return <SplashLoader message="Opening mobile view" />;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout, hasRole, hasPermission } = useAuth();
  const { running, progress } = useAutoMatch();
  const router = useRouter();
  const pathname = usePathname();

  // Longest-href-wins: picks whichever nav item's href best matches the
  // current path, so sibling routes that happen to share a prefix (e.g.
  // /dashboard vs /dashboard/executive) don't all light up together.
  const activeHref = NAV.flatMap((g) => g.items)
    .flatMap((item) => [item.href, ...(item.alsoActive ?? [])].map((prefix) => ({ href: item.href, prefix })))
    .filter(({ prefix }) => pathname === prefix || pathname?.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.href;
  const activeSection = NAV.find((g) => g.items.some((item) => item.href === activeHref))?.section ?? null;

  const [theme, setThemeState] = useState<Theme>('light');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewMode, setViewModeState] = useState<ViewMode | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  // Accordion: only one nav group is expanded at a time. Starts on the group
  // holding the current page; null = all folded.
  const [openGroup, setOpenGroup] = useState<string | null>(activeSection);

  useEffect(() => {
    setMobileOpen(false);
    setFabOpen(false);
    if (activeSection) setOpenGroup(activeSection);
  }, [pathname, activeSection]);

  useEffect(() => {
    setThemeState(getTheme());
    setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
    // An email's "Mobile Mode" link carries ?view=mobile: open the phone layout whatever view was saved.
    if (new URLSearchParams(window.location.search).get('view') === 'mobile') {
      localStorage.setItem(VIEW_STORAGE_KEY, 'mobile');
      setViewModeState('mobile');
    } else {
      setViewModeState(resolveViewMode());
    }
  }, []);

  useEffect(() => {
    // Remember where the visitor was heading (e.g. an email deep link) so login can send them back there.
    if (!loading && !user) router.replace(loginUrlFor(`${window.location.pathname}${window.location.search}`));
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

  const toggleGroup = (section: string) => {
    setOpenGroup((prev) => (prev === section ? null : section));
  };

  if (loading) return <SplashLoader message="Loading" />;
  if (!user) return null;

  const isVisible = (item: NavItem) =>
    (item.hidePositions?.some((c) => positionMatches(user.position?.code, c)) || (item.hideRoles && hasRole(...item.hideRoles))
      ? false
      : item.positions
      ? item.positions.some((c) => positionMatches(user.position?.code, c))
      : (item.roles.length === 0 && !item.permissions) || hasRole(...item.roles) || hasPermission(...(item.permissions ?? []))) &&
    (!item.requirePermissions || hasRole('ADMINISTRATOR') || hasPermission(...item.requirePermissions));

  // Sales is always the phone layout (bottom tab bar, no sidebar). Everyone else
  // picks Mobile or Desktop View; the default follows the device they opened it on.
  const canChooseView = !hasRole('SALES');
  if (canChooseView && !viewMode) return <SplashLoader message="Preparing your workspace" />;
  const bottomNav = !canChooseView || viewMode === 'mobile';
  // "New Expense" / "New Request" stay reachable via the FAB only - the bottom bar drops them to save a slot.
  const tabs = MOBILE_NAV.filter(isVisible).filter(
    (item) => item.href !== '/m/expense/new' && item.href !== '/m/expense-requests/new',
  );

  const newExpenseItem = MOBILE_NAV.find((item) => item.href === '/m/expense/new');
  const newRequestItem = MOBILE_NAV.find((item) => item.href === '/m/expense-requests/new');
  const canNewExpense = !!newExpenseItem && isVisible(newExpenseItem);
  const canNewRequest = !!newRequestItem && isVisible(newRequestItem);
  const onNewFormPage = pathname === '/m/expense/new' || pathname === '/m/expense-requests/new';

  // Mobile view (and SALES, locked to it) may only open the web mobile pages under /m.
  // Any other URL (typed in, bookmarked, left over from desktop view) is sent to the first tab.
  const outsideMobile = !!pathname && !/^\/m(\/|$)/.test(pathname);
  if (bottomNav && outsideMobile && tabs.length > 0) {
    return <RedirectTo href={tabs[0].href} />;
  }

  if (bottomNav) {
    return (
      <div className="mobile-shell">
        <header className="mobile-topbar">
          <div className="mobile-brand">
            <BrandLogo variant="mark" height={30} />
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
        {(canNewExpense || canNewRequest) && !onNewFormPage && (
          <>
            {fabOpen && <div className="fab-backdrop" onClick={() => setFabOpen(false)} aria-hidden="true" />}
            <div className="fab-wrap">
              {fabOpen && (
                <div className="fab-menu" role="menu">
                  {canNewExpense && (
                    <Link href="/m/expense/new" className="fab-menu-item" role="menuitem" onClick={() => setFabOpen(false)}>
                      <span className="nav-icon"><NavIcon name="expenses" /></span>
                      Entertainment
                    </Link>
                  )}
                  {canNewRequest && (
                    <Link href="/m/expense-requests/new" className="fab-menu-item" role="menuitem" onClick={() => setFabOpen(false)}>
                      <span className="nav-icon"><NavIcon name="expenses" /></span>
                      Flower Bouquet
                    </Link>
                  )}
                </div>
              )}
              <button
                type="button"
                className={`fab${fabOpen ? ' fab-open' : ''}`}
                onClick={() => setFabOpen((prev) => !prev)}
                aria-label={fabOpen ? 'Close menu' : 'New'}
                aria-expanded={fabOpen}
              >
                <NavIcon name="plus" />
              </button>
            </div>
          </>
        )}
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
            <BrandLogo variant="mark" height={26} />
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
            // Icon-only sidebar has no labels to click, so groups stay open there.
            const groupClosed = !group.standalone && !effectiveCollapsed && openGroup !== group.section;
            return (
              <div key={group.section}>
                {group.standalone ? null : effectiveCollapsed ? (
                  <div className="group-label">
                    <span>{group.section}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`group-label group-toggle${groupClosed ? ' closed' : ''}`}
                    onClick={() => toggleGroup(group.section)}
                    aria-expanded={!groupClosed}
                  >
                    <span>{group.section}</span>
                    <span className="group-chevron" aria-hidden="true">▾</span>
                  </button>
                )}
                {!groupClosed && visibleItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={item.href === activeHref ? 'active' : ''}
                    title={effectiveCollapsed ? item.label : undefined}
                  >
                    {!(item.hideIconWhenExpanded && !effectiveCollapsed) && (
                      <span className="nav-icon"><NavIcon name={item.icon} /></span>
                    )}
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
