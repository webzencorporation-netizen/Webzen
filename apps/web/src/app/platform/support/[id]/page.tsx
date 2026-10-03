import type { Metadata } from 'next';
import { PlatformTicketPage } from '@/features/platform/support-ticket-page';

export const metadata: Metadata = { title: 'Chamado · Plataforma' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformTicketPage id={id} />;
}
