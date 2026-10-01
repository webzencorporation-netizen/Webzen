import type { Metadata } from 'next';
import { PlatformAdminPage } from '@/features/platform/admin-page';

export const metadata: Metadata = { title: 'Administração · Plataforma' };

export default function Page() {
  return <PlatformAdminPage />;
}
