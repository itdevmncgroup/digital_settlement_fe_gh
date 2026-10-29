'use client';

import ExpensesView from '@/components/ExpensesView';
import FlowerBouquetTabs from '@/components/FlowerBouquetTabs';

// Transaction > Flower Bouquet > Expense tab (Flower Bouquet Expenses).
export default function FlowerBouquetExpensesPage() {
  return (
    <div>
      <FlowerBouquetTabs active="expense" />
      <ExpensesView scope="flower" />
    </div>
  );
}
