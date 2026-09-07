'use client';

import MasterCrudPage from '@/components/MasterCrudPage';

// Agency sits above Advertiser (Agency -> Advertiser -> Brand) - a distinct
// entity from Advertiser, not the same thing.
export default function AgenciesPage() {
  return (
    <MasterCrudPage
      title="Agency"
      apiPath="/agencies"
      fields={[
        { key: 'code', label: 'Code', type: 'text', required: true },
        { key: 'name', label: 'Name', type: 'text', required: true },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'isActive', label: 'Active' },
      ]}
    />
  );
}
