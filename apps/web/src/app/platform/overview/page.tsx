import type { Metadata } from 'next';
import { PlatformOverviewPage } from '@/features/platform/overview-page';

export const metadata: Metadata = { title: 'Indicadores · Plataforma' };

export default function Page() {
  return <PlatformOverviewPage />;
}
