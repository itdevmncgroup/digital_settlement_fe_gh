'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SplashLoader from '@/components/SplashLoader';
import { useAuth } from '@/lib/auth';
import { positionMatches } from '@/lib/position';
import { resolveViewMode } from '@/lib/viewMode';

export default function RootPage() {
  const { user, loading, hasRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (positionMatches(user.position?.code, 'HEAD_POD')) {
      router.replace('/m/dashboard-head-dept');
    } else if (positionMatches(user.position?.code, 'CO-CSO')) {
      router.replace('/m/dashboard-co-cso');
    } else if (hasRole('MANAGEMENT') && !hasRole('ADMIN')) {
      router.replace('/m/dashboard-management');
    } else if (hasRole('SALES') || (hasRole('ADMIN', 'MANAGEMENT') && resolveViewMode() === 'mobile')) {
      router.replace('/m/dashboard');
    } else if (hasRole('ADMIN', 'MANAGEMENT')) {
      router.replace('/expense-dashboard');
    } else {
      router.replace('/expenses');
    }
  }, [loading, user, hasRole, router]);

  return <SplashLoader message="Signing you in" />;
}
