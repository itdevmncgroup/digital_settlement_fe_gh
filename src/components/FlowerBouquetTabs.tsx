'use client';

import PillTabs from './PillTabs';

const TABS = [
  { key: 'request', label: 'Request', href: '/expense-requests' },
  { key: 'expense', label: 'Expense', href: '/flower-bouquet/expenses' },
] as const;

// Tab bar of the Transaction > Flower Bouquet menu: Expense Requests and the Flower Bouquet Expenses raised from them.
// Each tab is its own route (their lists are big, independent pages), this just presents them as tabs.
export default function FlowerBouquetTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  return <PillTabs tabs={[...TABS]} active={active} />;
}
