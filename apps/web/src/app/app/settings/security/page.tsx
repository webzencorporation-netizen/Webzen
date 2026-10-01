import type { Metadata } from 'next';
import { SecurityPage } from '@/features/settings/security-page';

export const metadata: Metadata = { title: 'Conta e segurança' };

export default function Page() {
  return <SecurityPage />;
}
