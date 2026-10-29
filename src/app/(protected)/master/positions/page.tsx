'use client';

import MasterCrudPage from '@/components/MasterCrudPage';

export default function PositionsPage() {
  return (
    <MasterCrudPage
      title="Position"
      apiPath="/positions"
      fields={[
        { key: 'code', label: 'Code', type: 'text', required: true },
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'isActive', label: 'Active' },
      ]}
    />
  );
}
