import type { Metadata } from 'next';
import { PlatformSupportPage } from '@/features/platform/support-page';

export const metadata: Metadata = { title: 'Suporte · Plataforma' };

export default function Page() {
  return <PlatformSupportPage />;
}
