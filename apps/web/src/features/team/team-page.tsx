'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, RotateCw, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Avatar, EmptyState, PageHeader, Skeleton, Switch, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { roleLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import type { Member } from '../types';

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  lastSentAt: string;
  expired: boolean;
}

const emailValid = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

const ROLE_DESCRIPTIONS: Record<string, string> = {
  COMPANY_OWNER: 'Controle total da empresa.',
  COMPANY_ADMIN: 'Quase todas as configurações.',
  MANAGER: 'CRM, conversas, agenda e relatórios.',
  ATTENDANT: 'Conversas atribuídas e fila de atendimento.',
  VIEWER: 'Somente leitura.',
};

export function TeamPage() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const { data: me } = useMe();
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'ATTENDANT' });
  const [removing, setRemoving] = useState<Member | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const members = useQuery({ queryKey: ['team'], queryFn: () => api.get<Member[]>('/app/team') });
  const invitations = useQuery({ queryKey: ['team-invitations'], queryFn: () => api.get<Invitation[]>('/app/team/invitations') });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['team'] });
    void client.invalidateQueries({ queryKey: ['team-invitations'] });
  };
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const invite = useMutation({
    mutationFn: () => api.post<Invitation>('/app/team/invitations', form),
    onSuccess: (result) => {
      refresh();
      setInviting(false);
      setForm({ email: '', role: 'ATTENDANT' });
      toast.success(`Convite enviado para ${result.email}.`);
    },
    onError,
  });
  const resend = useMutation({
    mutationFn: (id: string) => api.post(`/app/team/invitations/${id}/resend`),
    onSuccess: () => { refresh(); toast.success('Convite reenviado.'); },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/app/team/invitations/${id}`),
    onSuccess: () => { setRevoking(null); refresh(); toast.success('Convite cancelado.'); },
    onError,
  });
  const update = useMutation({ mutationFn: ({ id, ...body }: { id: string; role?: string; isActive?: boolean }) => api.patch(`/app/team/${id}`, body), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/app/team/${id}`), onSuccess: () => { setRemoving(null); refresh(); }, onError });
  const manage = can('team:manage');

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Equipe" description="Quem acessa o painel e o que cada pessoa pode fazer." actions={manage ? <Button onClick={() => setInviting(true)}><Plus className="h-4 w-4" /> Convidar pessoa</Button> : null} />
      <Card>
        {members.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !members.data?.length ? <EmptyState icon={Users} title="Nenhum membro" /> : (
          <Table>
            <thead><tr><Th>Pessoa</Th><Th>Papel</Th><Th>Último acesso</Th><Th>Ativo</Th><Th /></tr></thead>
            <tbody>
              {members.data.map((member) => {
                const self = member.user.id === me?.user.id;
                return (
                  <tr key={member.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={member.user.name} className="h-8 w-8" />
                        <div><p className="font-medium text-slate-900">{member.user.name} {self ? <Badge className="ml-1">você</Badge> : null}</p><p className="text-xs text-muted">{member.user.email}</p></div>
                      </div>
                    </Td>
                    <Td>
                      {manage && !self ? (
                        <Select value={member.role} onChange={(event) => update.mutate({ id: member.id, role: event.target.value })} className="w-44" aria-label="Papel">
                          {Object.keys(ROLE_DESCRIPTIONS).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                        </Select>
                      ) : roleLabels[member.role]}
                    </Td>
                    <Td className="text-muted">{formatDateTime(member.user.lastLoginAt)}</Td>
                    <Td><Switch checked={member.isActive} disabled={!manage || self} onCheckedChange={(value) => update.mutate({ id: member.id, isActive: value })} label="Ativo" /></Td>
                    <Td className="text-right">{manage && !self ? <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(member)} aria-label="Remover"><Trash2 className="h-4 w-4 text-red-500" /></Button> : null}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {invitations.data && invitations.data.length > 0 ? (
        <Card className="mt-6">
          <CardHeader title="Convites pendentes" description="O convite vale por 7 dias e só pode ser usado uma vez." />
          <ul className="divide-y divide-border">
            {invitations.data.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Mail className="h-4 w-4" aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{invitation.email}</p>
                    <p className="text-xs text-muted">
                      {roleLabels[invitation.role]} · {invitation.expired ? 'expirado' : `expira em ${formatDateTime(invitation.expiresAt)}`}
                    </p>
                  </div>
                  {invitation.expired ? <Badge tone="amber">Expirado</Badge> : null}
                </div>
                {manage ? (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => resend.mutate(invitation.id)} loading={resend.isPending && resend.variables === invitation.id}>
                      <RotateCw className="h-4 w-4" /> Reenviar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRevoking(invitation)} aria-label={`Cancelar convite de ${invitation.email}`}>
                      <X className="h-4 w-4" /> Cancelar convite
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Dialog open={inviting} onOpenChange={setInviting} title="Convidar pessoa para a equipe" description="Enviamos um link por e-mail. A pessoa cria a própria senha ao aceitar." footer={<Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!emailValid(form.email)}>Enviar convite</Button>}>
        <div className="space-y-4">
          <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
          <Field label="Papel" hint={ROLE_DESCRIPTIONS[form.role]}>
            {(id) => <Select id={id} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.keys(ROLE_DESCRIPTIONS).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</Select>}
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog open={Boolean(revoking)} onOpenChange={(open) => !open && setRevoking(null)} title="Cancelar o convite?" description={`O link enviado para ${revoking?.email ?? ''} deixa de funcionar.`} confirmLabel="Cancelar convite" loading={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking.id)} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)} title="Remover da equipe?" description={`${removing?.user.name} perderá o acesso a esta empresa.`} confirmLabel="Remover" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </PageContainer>
  );
}
