import { PlatformCompanyPage } from '@/features/platform/company-detail-page';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformCompanyPage companyId={id} />;
}
