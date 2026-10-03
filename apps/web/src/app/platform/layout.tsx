import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PlatformShell } from '@/components/layout/platform-shell';

/** Área logada: fora dos buscadores. */
export const metadata: Metadata = { title: { default: 'Plataforma', template: '%s · WebZen' }, robots: { index: false, follow: false } };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
