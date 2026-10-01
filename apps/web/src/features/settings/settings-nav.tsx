'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useCan } from '@/lib/session';

/** Seções de Configurações. Cada uma tem URL própria (links de e-mail e notificações levam direto). */
export function SettingsNav() {
  const pathname = usePathname();
  const can = useCan();
  const items = [
    { href: '/app/settings', label: 'Empresa', visible: true },
    { href: '/app/settings/billing', label: 'Assinatura', visible: can('billing:read') },
    { href: '/app/settings/security', label: 'Conta e segurança', visible: true },
  ].filter((item) => item.visible);
  return (
    <nav aria-label="Seções de configurações" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'border-brand-600 text-foreground' : 'border-transparent text-slate-500 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
