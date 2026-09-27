import { ContactPage } from '@/features/contacts/contact-page';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactPage contactId={id} />;
}
