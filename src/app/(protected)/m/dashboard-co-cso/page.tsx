'use client';

import DepartmentOdooDashboardView from '@/components/DepartmentOdooDashboardView';
import WebMobileGate from '@/components/WebMobileGate';

export default function CoCsoDashboardPage() {
  return (
    <WebMobileGate permissions={['webmobile.dashboard.read.own', 'webmobile.dashboard.read.owndept']}>
      <DepartmentOdooDashboardView
        title="Dashboard CO-CSO"
        endpoint="/dashboard/co-cso"
        chartTitle="Top 10 departments by complete expense"
      />
    </WebMobileGate>
  );
}
