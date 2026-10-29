'use client';

import MasterCrudPage from '@/components/MasterCrudPage';

export default function UnitsPage() {
  return (
    <MasterCrudPage
      title="Unit"
      apiPath="/units"
      fields={[
        { key: 'code', label: 'Code', type: 'text', required: true },
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'fullName', label: 'Full Name', type: 'text' },
        { key: 'logo', label: 'Logo', type: 'image' },
        { key: 'revenueSharePercent', label: 'Default Settlement %', type: 'text' },
        { key: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { key: 'logo', label: 'Logo', type: 'image' },
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'fullName', label: 'Full Name' },
        { key: 'revenueSharePercent', label: 'Default Settlement %' },
        { key: 'isActive', label: 'Active' },
      ]}
    />
  );
}
