import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntegrationsPage } from '@/features/integrations/integrations-page';

export const metadata: Metadata = { title: 'Integrações' };

export default function Page() {
  return (
    <Suspense>
      <IntegrationsPage />
    </Suspense>
  );
}
