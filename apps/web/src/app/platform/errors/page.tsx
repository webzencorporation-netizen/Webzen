import type { Metadata } from 'next';
import { PlatformErrorsPage } from '@/features/platform/errors-page';

export const metadata: Metadata = { title: 'Erros · Plataforma' };

export default function Page() {
  return <PlatformErrorsPage />;
}
