'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function RootPage() {
  const { user, loading, hasRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    router.replace(hasRole('ADMIN', 'FINANCE', 'MANAGEMENT') ? '/dashboard' : '/expenses');
  }, [loading, user, hasRole, router]);

  return null;
}
