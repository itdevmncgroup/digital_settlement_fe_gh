'use client';

import WebMobileGate from '@/components/WebMobileGate';
import ExpenseRequestForm from '../ExpenseRequestForm';

export default function NewExpenseRequestPage() {
  return (
    <WebMobileGate permissions={['webmobile.request.expense.create.own', 'webmobile.request.expense.create.owndept']}>
      <ExpenseRequestForm />
    </WebMobileGate>
  );
}
