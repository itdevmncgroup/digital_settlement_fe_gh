'use client';

import ApproverDashboardView from '@/components/ApproverDashboardView';
import WebMobileGate from '@/components/WebMobileGate';

export default function ManagementDashboardPage() {
  return (
    <WebMobileGate permissions={['webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept']}>
      <ApproverDashboardView title="Dashboard Management" endpoint="/dashboard/management" />
    </WebMobileGate>
  );
}
