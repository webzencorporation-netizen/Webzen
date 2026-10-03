import type { Metadata } from 'next';
import { ContactPage } from '@/features/contacts/contact-page';

export const metadata: Metadata = { title: 'Contato' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactPage contactId={id} />;
}
