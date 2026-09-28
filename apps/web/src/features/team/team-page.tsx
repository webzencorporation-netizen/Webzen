'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  const [form, setForm] = useState({ name: '', email: '', role: 'ATTENDANT' });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const members = useQuery({ queryKey: ['team'], queryFn: () => api.get<Member[]>('/app/team') });
  const refresh = () => void client.invalidateQueries({ queryKey: ['team'] });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const invite = useMutation({
    mutationFn: () => api.post<{ temporaryPassword: string | null }>('/app/team', form),
    onSuccess: (result) => { refresh(); setInviting(false); setForm({ name: '', email: '', role: 'ATTENDANT' }); if (result.temporaryPassword) setTempPassword(result.temporaryPassword); else toast.success('Usuário adicionado à equipe.'); },
    onError,
  });
  const update = useMutation({ mutationFn: ({ id, ...body }: { id: string; role?: string; isActive?: boolean }) => api.patch(`/app/team/${id}`, body), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/app/team/${id}`), onSuccess: () => { setRemoving(null); refresh(); }, onError });
  const manage = can('team:manage');

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Equipe" description="Quem acessa o painel e o que cada pessoa pode fazer." actions={manage ? <Button onClick={() => setInviting(true)}><Plus className="h-4 w-4" /> Adicionar pessoa</Button> : null} />
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
      <Dialog open={inviting} onOpenChange={setInviting} title="Adicionar pessoa à equipe" footer={<Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!form.email || form.name.length < 2}>Adicionar</Button>}>
        <div className="space-y-4">
          <Field label="Nome">{(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
          <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
          <Field label="Papel" hint={ROLE_DESCRIPTIONS[form.role]}>
            {(id) => <Select id={id} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.keys(ROLE_DESCRIPTIONS).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</Select>}
          </Field>
        </div>
      </Dialog>
      <Dialog open={Boolean(tempPassword)} onOpenChange={() => setTempPassword(null)} title="Acesso criado" description="Envie a senha temporária para a pessoa por um canal seguro. Ela deverá trocá-la no primeiro acesso." size="sm">
        <code className="block rounded-lg bg-slate-900 px-3 py-2 text-center font-mono text-lg text-white">{tempPassword}</code>
      </Dialog>
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)} title="Remover da equipe?" description={`${removing?.user.name} perderá o acesso a esta empresa.`} confirmLabel="Remover" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </PageContainer>
  );
}
