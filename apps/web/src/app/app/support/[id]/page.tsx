import type { Metadata } from 'next';
import { TicketPage } from '@/features/support/ticket-page';

export const metadata: Metadata = { title: 'Chamado' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketPage id={id} />;
}
