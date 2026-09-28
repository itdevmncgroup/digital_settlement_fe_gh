'use client';

import { useParams } from 'next/navigation';
import SettlementForm from '@/components/SettlementForm';

export default function EditSettlementPage() {
  const { id } = useParams<{ id: string }>();
  return <SettlementForm settlementId={id} />;
}
