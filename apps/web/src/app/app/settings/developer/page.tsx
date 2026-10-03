import type { Metadata } from 'next';
import { DeveloperPage } from '@/features/developer/developer-page';

export const metadata: Metadata = { title: 'API e webhooks' };

export default function Page() {
  return <DeveloperPage />;
}
