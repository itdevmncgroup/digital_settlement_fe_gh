'use client';

import DepartmentOdooDashboardView from '@/components/DepartmentOdooDashboardView';
import WebMobileGate from '@/components/WebMobileGate';

export default function HeadDeptDashboardPage() {
  return (
    <WebMobileGate permissions={['webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept']}>
      <DepartmentOdooDashboardView title="Dashboard Head Dept" endpoint="/dashboard/head-pod" chartTitle="Top 10 sales by expense" />
    </WebMobileGate>
  );
}
