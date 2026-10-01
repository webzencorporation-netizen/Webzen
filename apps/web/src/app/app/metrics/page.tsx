import type { Metadata } from 'next';
import { MetricsPage } from '@/features/metrics/metrics-page';

export const metadata: Metadata = { title: 'Métricas' };

export default function Page() {
  return <MetricsPage />;
}
