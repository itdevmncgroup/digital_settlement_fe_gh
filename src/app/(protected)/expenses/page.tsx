'use client';

import ExpensesView from '@/components/ExpensesView';

// Transaction > Entertainment (every Expense except Flower Bouquet).
export default function ExpensesPage() {
  return <ExpensesView scope="entertainment" />;
}
