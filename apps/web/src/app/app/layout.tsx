import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CompanyShell } from '@/components/layout/company-shell';

/** Área logada: fora dos buscadores. */
export const metadata: Metadata = { title: { default: 'Painel', template: '%s · WebZen' }, robots: { index: false, follow: false } };

export default function CompanyLayout({ children }: { children: ReactNode }) {
  return <CompanyShell>{children}</CompanyShell>;
}
