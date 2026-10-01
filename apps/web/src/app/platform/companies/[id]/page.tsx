import type { Metadata } from 'next';
import { PlatformCompanyPage } from '@/features/platform/company-detail-page';

export const metadata: Metadata = { title: 'Empresa · Plataforma' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformCompanyPage companyId={id} />;
}
