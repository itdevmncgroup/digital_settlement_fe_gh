'use client';

import { useParams } from 'next/navigation';
import ExpenseForm from '../../ExpenseForm';

export default function EditSalesExpensePage() {
  const { id } = useParams<{ id: string }>();
  return <ExpenseForm expenseId={id} />;
}
