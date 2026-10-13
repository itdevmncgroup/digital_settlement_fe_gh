'use client';

import WebMobileGate from '@/components/WebMobileGate';
import ExpenseForm from '../ExpenseForm';

export default function NewSalesExpensePage() {
  return (
    <WebMobileGate permissions={['webmobile.expense.create.own', 'webmobile.expense.create.owndept']}>
      <ExpenseForm />
    </WebMobileGate>
  );
}
