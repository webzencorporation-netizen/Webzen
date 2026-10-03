import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BillingPage } from '@/features/billing/billing-page';

export const metadata: Metadata = { title: 'Assinatura' };

export default function Page() {
  return (
    <Suspense>
      <BillingPage />
    </Suspense>
  );
}
