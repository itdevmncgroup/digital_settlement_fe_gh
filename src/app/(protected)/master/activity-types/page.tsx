'use client';

import MasterCrudPage from '@/components/MasterCrudPage';

export default function ActivityTypesPage() {
  return (
    <MasterCrudPage
      title="Activity Type"
      apiPath="/activity-types"
      fields={[{ key: 'name', label: 'Name', type: 'text', required: true }]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'isActive', label: 'Active' },
      ]}
    />
  );
}
