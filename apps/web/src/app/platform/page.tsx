import type { Metadata } from 'next';
import { PlatformCompaniesPage } from '@/features/platform/companies-page';

export const metadata: Metadata = { title: 'Empresas · Plataforma' };

export default function Page() {
  return <PlatformCompaniesPage />;
}
