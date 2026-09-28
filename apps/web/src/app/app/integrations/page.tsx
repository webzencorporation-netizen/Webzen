import { Suspense } from 'react';
import { IntegrationsPage } from '@/features/integrations/integrations-page';

export default function Page() {
  return (
    <Suspense>
      <IntegrationsPage />
    </Suspense>
  );
}
