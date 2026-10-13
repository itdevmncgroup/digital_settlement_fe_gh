'use client';

import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

// Page-level access check for a Web Mobile page (/m/...): renders `children` only for an
// Administrator or a holder of at least one of `permissions` (the webmobile.* codes). The
// matching AppShell MOBILE_NAV item hides the link; this covers someone opening the URL directly.
export default function WebMobileGate({ permissions, children }: { permissions: string[]; children: ReactNode }) {
  const { user, hasRole, hasPermission } = useAuth();
  if (!user) return null;
  if (hasRole('ADMINISTRATOR') || hasPermission(...permissions)) return <>{children}</>;
  return <div className="m-empty">You don&apos;t have access to this page.</div>;
}
