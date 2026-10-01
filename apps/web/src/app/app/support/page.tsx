import type { Metadata } from 'next';
import { SupportPage } from '@/features/support/support-page';

export const metadata: Metadata = { title: 'Suporte' };

export default function Page() {
  return <SupportPage />;
}
