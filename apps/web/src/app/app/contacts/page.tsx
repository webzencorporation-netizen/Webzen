import type { Metadata } from 'next';
import { ContactsPage } from '@/features/contacts/contacts-page';

export const metadata: Metadata = { title: 'Contatos' };

export default function Page() {
  return <ContactsPage />;
}
