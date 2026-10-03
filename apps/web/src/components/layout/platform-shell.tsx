'use client';

import { Activity, AlertTriangle, Building2, CreditCard, Gauge, LifeBuoy, LineChart, Menu, Receipt, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useRequireSession } from '@/lib/session';
import { UserMenu } from './user-menu';

const NAV = [
  { href: '/platform/overview', label: 'Indicadores', icon: LineChart },
  { href: '/platform', label: 'Empresas', icon: Building2 },
  { href: '/platform/plans', label: 'Planos', icon: CreditCard },
  { href: '/platform/billing', label: 'Cobrança', icon: Receipt },
  { href: '/platform/support', label: 'Suporte', icon: LifeBuoy },
  { href: '/platform/usage', label: 'Uso', icon: Gauge },
  { href: '/platform/errors', label: 'Erros', icon: AlertTriangle },
  { href: '/platform/admin', label: 'Administração', icon: Activity },
];

/** Área da PLATAFORMA — visual distinto (escuro) para não se confundir com o painel das empresas. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const me = useRequireSession();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (me.data && !me.data.platformRole) router.replace('/app');
  }, [me.data, router]);

  if (!me.data?.platformRole) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Menu da plataforma">
      <div className="mb-4 flex items-center justify-between px-2 py-1">
        <span className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-hour text-ink"><ShieldCheck className="h-4 w-4" /></span>
          WebZen interno
        </span>
        <button className="text-white/60 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu"><X className="h-5 w-5" /></button>
      </div>
      {NAV.map((item) => {
        const active = item.href === '/platform' ? pathname === '/platform' || pathname.startsWith('/platform/companies') : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
            <item.icon className="h-4 w-4" /> {item.label}
          </Link>
        );
      })}
      {me.data.activeCompany ? (
        <Link href="/app" className="mt-auto rounded-lg px-3 py-2 text-xs text-white/60 hover:text-white">← Voltar ao painel da empresa</Link>
      ) : null}
    </nav>
  );

  return (
    <div className="flex h-dvh">
      <aside className="hidden w-60 shrink-0 bg-ink-deep lg:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-deep/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-ink-deep">{sidebar}</aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
          <button className="rounded-md p-1.5 text-slate-500 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>
          <span className="hidden text-sm font-medium text-muted lg:block">Administração da plataforma WebZen</span>
          <UserMenu me={me.data} />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
