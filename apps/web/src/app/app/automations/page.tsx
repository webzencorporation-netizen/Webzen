import type { Metadata } from 'next';
import { AutomationsPage } from '@/features/automations/automations-page';

export const metadata: Metadata = { title: 'Automações' };

export default function Page() {
  return <AutomationsPage />;
}
