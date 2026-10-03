import type { Metadata } from 'next';
import { PlatformBillingPage } from '@/features/platform/billing-page';

export const metadata: Metadata = { title: 'Cobrança · Plataforma' };

export default function Page() {
  return <PlatformBillingPage />;
}
