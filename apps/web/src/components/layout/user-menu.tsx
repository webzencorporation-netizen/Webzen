'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { Avatar } from '@/components/ui/misc';
import { ChangePasswordDialog } from './change-password-dialog';
import { api } from '@/lib/api';
import { useLogout, type Me } from '@/lib/session';
import { roleLabels } from '@/i18n/pt-BR';

const itemClass = 'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-slate-700 outline-none hover:bg-slate-100 focus:bg-slate-100';

export function UserMenu({ me }: { me: Me }) {
  const logout = useLogout();
  const router = useRouter();
  const client = useQueryClient();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const switchCompany = useMutation({
    mutationFn: (companyId: string) => api.post<Me>('/auth/switch-company', { companyId }),
    onSuccess: (updated) => {
      client.clear();
      client.setQueryData(['me'], updated);
      router.push('/app');
    },
  });

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100">
          <Avatar name={me.user.name} className="h-8 w-8" />
          <span className="hidden text-left md:block">
            <span className="block text-sm font-medium leading-tight text-slate-800">{me.user.name}</span>
            <span className="block text-xs leading-tight text-muted">{me.activeCompany ? roleLabels[me.activeCompany.role] : roleLabels[me.platformRole ?? '']}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-xl border border-border bg-white p-1.5 shadow-xl">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium">{me.user.name}</p>
              <p className="truncate text-xs text-muted">{me.user.email}</p>
            </div>
            {me.memberships.length > 1 ? (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Label className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Empresas</DropdownMenu.Label>
                {me.memberships.map((membership) => (
                  <DropdownMenu.Item key={membership.companyId} className={itemClass} onSelect={() => switchCompany.mutate(membership.companyId)}>
                    <Building2 className="h-4 w-4 text-slate-400" />
                    <span className="flex-1 truncate">{membership.companyName}</span>
                    {me.activeCompany?.id === membership.companyId ? <Check className="h-4 w-4 text-brand-600" /> : null}
                  </DropdownMenu.Item>
                ))}
              </>
            ) : null}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            {me.platformRole ? (
              <DropdownMenu.Item asChild className={itemClass}>
                <Link href="/platform">
                  <ShieldCheck className="h-4 w-4 text-slate-400" /> Área da plataforma
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item className={itemClass} onSelect={() => setPasswordOpen(true)}>
              <KeyRound className="h-4 w-4 text-slate-400" /> Alterar senha
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={() => void logout()}>
              <LogOut className="h-4 w-4 text-slate-400" /> Sair
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ChangePasswordDialog open={passwordOpen || me.user.mustChangePassword} forced={me.user.mustChangePassword} onOpenChange={setPasswordOpen} />
    </>
  );
}
