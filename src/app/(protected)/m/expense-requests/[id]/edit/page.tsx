'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ExpenseRequest } from '@/lib/expenseRequests';
import { SkeletonList } from '@/lib/mobileUi';
import ExpenseRequestForm from '../../ExpenseRequestForm';

// Edit an Expense Request while it is still a DRAFT. No GET /expense-requests/:id
// exists, so it's found in the (already access-scoped) list, like the detail page.
export default function EditExpenseRequestPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<ExpenseRequest | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<ExpenseRequest[]>('/expense-requests')
      .then((all) => {
        const found = all.find((r) => r.id === id);
        setRequest(found ?? null);
        setNotFound(!found);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [id]);

  if (error) return <div className="error-text">{error}</div>;
  if (notFound) return <div className="m-empty">Expense request not found.</div>;
  if (!request) return <SkeletonList />;
  if (request.status !== 'DRAFT') {
    return (
      <div>
        <div className="m-empty">Only a Draft can be edited.</div>
        <Link href={`/m/expense-requests/${request.id}`}>‹ Back to {request.requestNo}</Link>
      </div>
    );
  }
  return <ExpenseRequestForm request={request} />;
}
