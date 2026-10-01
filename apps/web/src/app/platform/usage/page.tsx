import type { Metadata } from 'next';
import { PlatformUsagePage } from '@/features/platform/usage-page';

export const metadata: Metadata = { title: 'Uso · Plataforma' };

export default function Page() {
  return <PlatformUsagePage />;
}
