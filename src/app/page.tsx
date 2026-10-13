'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SplashLoader from '@/components/SplashLoader';
import { useAuth } from '@/lib/auth';
import { positionMatches } from '@/lib/position';
import { resolveViewMode } from '@/lib/viewMode';

export default function RootPage() {
  const { user, loading, hasRole, hasPermission } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    // The web mobile dashboards need webmobile.dashboard.read.own/.owndept; without it the user
    // is sent to the first other web mobile page they may open (or the desktop list below).
    const canMobileDashboard = hasRole('ADMINISTRATOR') || hasPermission('webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept');
    const firstMobilePage = [
      ['/m/expenses', ['webmobile.expense.read.own', 'webmobile.expense.read.owndept']],
      ['/m/expense-requests', ['webmobile.request.expense.read.own', 'webmobile.request.expense.read.owndept']],
      ['/m/approvals', ['webmobile.approval.read.own', 'webmobile.approval.read.owndept']],
      ['/m/profile', ['webmobile.profile.read.own']],
    ].find(([, perms]) => hasPermission(...(perms as string[])))?.[0] as string | undefined;

    if (canMobileDashboard && positionMatches(user.position?.code, 'HEAD-POD')) {
      router.replace('/m/dashboard-head-dept');
    } else if (canMobileDashboard && positionMatches(user.position?.code, 'CO-CSO')) {
      router.replace('/m/dashboard-co-cso');
    } else if (canMobileDashboard && hasRole('MANAGEMENT') && !hasRole('ADMIN')) {
      router.replace('/m/dashboard-management');
    } else if (canMobileDashboard && (hasRole('SALES') || (hasRole('ADMIN', 'MANAGEMENT') && resolveViewMode() === 'mobile'))) {
      router.replace('/m/dashboard');
    } else if (hasRole('ADMIN', 'MANAGEMENT')) {
      router.replace('/expense-dashboard');
    } else if (canMobileDashboard) {
      // Granted the web-mobile dashboard (e.g. Sales Customer Service) without
      // the SALES role - land there instead of the desktop Expenses list.
      router.replace('/m/dashboard');
    } else if (hasRole('SALES') && firstMobilePage) {
      // SALES is locked to the phone layout, so skip the desktop Expenses list.
      router.replace(firstMobilePage);
    } else {
      router.replace('/expenses');
    }
  }, [loading, user, hasRole, hasPermission, router]);

  return <SplashLoader message="Signing you in" />;
}
