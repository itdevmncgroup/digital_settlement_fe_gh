'use client';

import MasterCrudPage from '@/components/MasterCrudPage';

export default function DepartmentsPage() {
  return (
    <MasterCrudPage
      title="Department"
      apiPath="/departments"
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
