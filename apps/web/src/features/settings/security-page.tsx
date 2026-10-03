'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { ChangePasswordDialog } from '@/components/layout/change-password-dialog';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useMe } from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { SettingsNav } from './settings-nav';

interface SessionItem {
  id: string;
  device: string;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Do sistema', icon: Monitor },
];

export function SecurityPage() {
  const { data: me } = useMe();
  const toast = useToast();
  const client = useQueryClient();
  const { preference, choose } = useTheme();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [revokeAll, setRevokeAll] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionItem[]>('/auth/sessions') });
  const refresh = () => void client.invalidateQueries({ queryKey: ['sessions'] });
  const endOne = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      refresh();
      toast.success('Sessão encerrada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const endOthers = useMutation({
    mutationFn: () => api.post('/auth/sessions/revoke-others'),
    onSuccess: () => {
      setRevokeAll(false);
      refresh();
      toast.success('As outras sessões foram encerradas.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const others = (sessions.data ?? []).filter((session) => !session.current).length;

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Configurações" description="Dados da empresa, assinatura e segurança." />
      <SettingsNav />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Sua conta" />
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium text-foreground">{me?.user.name}</p>
              <p className="text-sm text-muted">{me?.user.email}</p>
            </div>
            <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
              <KeyRound className="h-4 w-4" /> Alterar senha
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Aparência" description="Vale para este navegador." />
          <CardContent>
            <div role="radiogroup" aria-label="Tema" className="grid gap-3 sm:grid-cols-3">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  role="radio"
                  aria-checked={preference === theme.value}
                  onClick={() => choose(theme.value)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors',
                    preference === theme.value ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600' : 'border-border text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <theme.icon className="h-4 w-4" aria-hidden />
                  {theme.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Sessões ativas"
            description="Onde sua conta está conectada. Encerre o que você não reconhecer e troque a senha."
            action={
              others > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => setRevokeAll(true)}>
                  Encerrar outras sessões
                </Button>
              ) : null
            }
          />
          {sessions.isLoading ? (
            <div className="p-5">
              <Skeleton className="h-24" />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(sessions.data ?? []).map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {session.device}
                      {session.current ? <Badge tone="brand">Esta sessão</Badge> : null}
                    </p>
                    <p className="text-xs text-muted">
                      {session.ip ? `IP ${session.ip} · ` : ''}último uso {formatRelative(session.lastSeenAt)} · entrou em {formatDateTime(session.createdAt)}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button variant="ghost" size="sm" onClick={() => endOne.mutate(session.id)} loading={endOne.isPending && endOne.variables === session.id}>
                      Encerrar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <ChangePasswordDialog open={passwordOpen} forced={false} onOpenChange={setPasswordOpen} />
      <ConfirmDialog
        open={revokeAll}
        onOpenChange={setRevokeAll}
        title="Encerrar as outras sessões?"
        description="Todos os outros navegadores e aparelhos precisarão entrar de novo. Esta sessão continua aberta."
        confirmLabel="Encerrar outras sessões"
        loading={endOthers.isPending}
        onConfirm={() => endOthers.mutate()}
      />
    </PageContainer>
  );
}
