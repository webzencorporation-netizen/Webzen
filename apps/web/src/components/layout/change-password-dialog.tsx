'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';

export function ChangePasswordDialog({ open, forced, onOpenChange }: { open: boolean; forced: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (next.length < 10) return setError('A nova senha precisa ter pelo menos 10 caracteres.');
    if (next !== confirm) return setError('As senhas não conferem.');
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Senha alterada.');
      setCurrent('');
      setNext('');
      setConfirm('');
      // Consultas protegidas podem ter recebido 403 enquanto a senha era provisória.
      // Recarrega as ativas e deixa as demais obsoletas para a próxima navegação.
      await client.invalidateQueries();
      onOpenChange(false);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !forced && onOpenChange(value)}
      title={forced ? 'Defina uma nova senha' : 'Alterar senha'}
      description={forced ? 'Por segurança, troque a senha temporária antes de continuar.' : undefined}
      size="sm"
      footer={
        <Button onClick={submit} loading={loading}>
          Salvar senha
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Senha atual">{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />}</Field>
        <Field label="Nova senha" hint="Mínimo de 10 caracteres.">{(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />}</Field>
        <Field label="Confirme a nova senha" error={error}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
