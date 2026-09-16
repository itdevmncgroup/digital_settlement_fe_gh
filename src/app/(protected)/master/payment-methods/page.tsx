'use client';

import MasterCrudPage from '@/components/MasterCrudPage';

export default function PaymentMethodsPage() {
  return (
    <MasterCrudPage
      title="Payment Method"
      apiPath="/payment-methods"
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
