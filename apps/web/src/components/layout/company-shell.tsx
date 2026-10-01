'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Menu, Rocket, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { SubscriptionBanner } from '@/features/billing/subscription-banner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useCan, useRequireSession } from '@/lib/session';
import { COMPANY_NAV } from './nav';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './user-menu';

function Brand() {
  return (
    <Link href="/app" className="px-2 text-slate-900" aria-label="WebZen — visão geral">
      <Logo />
    </Link>
  );
}

function SupportBanner({ expiresAt }: { expiresAt: string }) {
  const client = useQueryClient();
  const stop = useMutation({
    mutationFn: () => api.delete('/platform/support'),
    onSuccess: () => {
      client.clear();
      window.location.href = '/platform';
    },
  });
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950">
      <LifeBuoy className="h-4 w-4" />
      Modo suporte ativo (auditado) até {new Date(expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
      <button className="underline" onClick={() => stop.mutate()}>
        Sair do modo suporte
      </button>
    </div>
  );
}

export function CompanyShell({ children }: { children: ReactNode }) {
  const me = useRequireSession();
  const can = useCan();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const features = useQuery({
    queryKey: ['features'],
    queryFn: () => api.get<{ flag: string; enabled: boolean }[]>('/app/company/features'),
    enabled: Boolean(me.data?.activeCompany),
  });
  const counters = useQuery({
    queryKey: ['conversation-counters'],
    queryFn: () => api.get<{ unread: number; waiting: number }>('/app/conversations/counters'),
    enabled: Boolean(me.data?.activeCompany) && can('conversations:read'),
    refetchInterval: 20_000,
  });

  if (me.isLoading || !me.data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!me.data.activeCompany) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-center">
        <UserMenu me={me.data} />
        <p className="text-sm text-muted">Sua conta ainda não está vinculada a uma empresa.</p>
        {me.data.platformRole ? (
          <Button asChild>
            <Link href="/platform">Ir para a área da plataforma</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  const enabledFeatures = new Set((features.data ?? []).filter((item) => item.enabled).map((item) => item.flag));
  const nav = COMPANY_NAV.filter((item) => can(item.permission) && (!item.feature || !features.data || enabledFeatures.has(item.feature)));
  const company = me.data.activeCompany;
  const showOnboarding = !company.onboardingDone && can('settings:manage');

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Menu principal">
      <div className="mb-3 flex items-center justify-between py-1">
        <Brand />
        <button className="rounded-md p-1 text-slate-400 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mb-3 rounded-lg border border-border bg-surface-muted px-3 py-2">
        <p className="truncate text-sm font-medium text-slate-800">{company.name}</p>
        <p className="text-xs text-muted">{company.status === 'ACTIVE' ? 'Atendimento ativo' : 'Em configuração'}</p>
      </div>
      {showOnboarding ? (
        <Link href="/app/onboarding" onClick={() => setMobileOpen(false)} className="mb-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100">
          <Rocket className="h-4 w-4" /> Concluir configuração
        </Link>
      ) : null}
      {nav.map((item) => {
        const active = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
        const badge = item.href === '/app/conversations' ? (counters.data?.waiting ?? 0) + (counters.data?.unread ?? 0) : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-ink text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            <item.icon className={cn('h-4 w-4', active ? 'text-brand-300' : 'text-slate-400')} />
            <span className="flex-1">{item.label}</span>
            {badge > 0 ? <span className={cn('rounded-full px-1.5 text-[11px] font-semibold', active ? 'bg-white/20' : 'bg-brand-600 text-white')}>{badge > 99 ? '99+' : badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-dvh flex-col">
      {me.data.supportMode ? <SupportBanner expiresAt={me.data.supportMode.expiresAt} /> : null}
      <SubscriptionBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border bg-surface scrollbar-thin lg:block">{sidebar}</aside>
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-ink-deep/40" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface shadow-xl">{sidebar}</aside>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur lg:px-6">
            <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex-1" />
            <NotificationBell />
            <UserMenu me={me.data} />
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</main>
        </div>
      </div>
    </div>
  );
}

/** Container padrão das páginas do painel. */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8', className)}>{children}</div>;
}
