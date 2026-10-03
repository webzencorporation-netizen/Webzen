import type { Metadata } from 'next';
import { CrmBoard } from '@/features/crm/kanban';

export const metadata: Metadata = { title: 'CRM' };

export default function Page() {
  return <CrmBoard />;
}
