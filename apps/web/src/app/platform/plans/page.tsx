import type { Metadata } from 'next';
import { PlansPage } from '@/features/platform/plans-page';

export const metadata: Metadata = { title: 'Planos · Plataforma' };

export default function Page() {
  return <PlansPage />;
}
