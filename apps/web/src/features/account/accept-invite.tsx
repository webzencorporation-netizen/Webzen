'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell, FormAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useLogout, useMe, type Me } from '@/lib/session';

interface InvitePreview {
  companyName: string;
  email: string;
  roleLabel: string;
  hasAccount: boolean;
}

const PASSWORD_MIN = 10;

export function AcceptInvite() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const client = useQueryClient();
  const me = useMe();
  const logout = useLogout();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.post<InvitePreview>('/auth/invitations/preview', { token }),
    enabled: token.length > 0,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: (body: { name?: string; password?: string }) => api.post<Me>('/auth/invitations/accept', { token, ...body }),
    onSuccess: (updated) => {
      client.clear();
      client.setQueryData(['me'], updated);
      router.replace('/app');
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  if (!token || preview.isError) {
    return (
      <AuthShell title="Convite indisponível" description="O convite pode ter expirado, sido cancelado ou já ter sido usado.">
        <div className="space-y-5">
          {preview.isError ? <FormAlert>{errorMessage(preview.error)}</FormAlert> : null}
          <p className="text-sm text-muted">Peça a quem convidou que envie um novo convite.</p>
        </div>
      </AuthShell>
    );
  }
  if (!preview.data || me.isLoading) {
    return (
      <AuthShell title="Abrindo convite">
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </AuthShell>
    );
  }

  const invite = preview.data;
  const description = `Você foi convidado para a equipe da ${invite.companyName} como ${invite.roleLabel.toLowerCase()}.`;
  const loggedEmail = me.data?.user.email;

  if (invite.hasAccount) {
    const sameAccount = loggedEmail === invite.email;
    return (
      <AuthShell title="Aceitar convite" description={description}>
        <div className="space-y-5">
          {sameAccount ? (
            <Button className="w-full" size="lg" loading={accept.isPending} onClick={() => accept.mutate({})}>
              Entrar na equipe
            </Button>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                O convite é para <strong className="text-foreground">{invite.email}</strong>. Entre com essa conta para aceitar.
              </p>
              {loggedEmail ? (
                <Button className="w-full" variant="secondary" onClick={() => void logout()}>
                  Sair de {loggedEmail}
                </Button>
              ) : (
                <Button asChild className="w-full" size="lg">
                  <Link href={`/login?next=${encodeURIComponent(`/convite?token=${token}`)}`}>Entrar como {invite.email}</Link>
                </Button>
              )}
            </>
          )}
          {formError ? <FormAlert>{formError}</FormAlert> : null}
        </div>
      </AuthShell>
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setFormError('Informe seu nome.');
    if (password.length < PASSWORD_MIN) return setFormError(`A senha precisa de pelo menos ${PASSWORD_MIN} caracteres.`);
    setFormError(null);
    accept.mutate({ name: name.trim(), password });
  }

  return (
    <AuthShell title="Criar sua conta" description={description}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="E-mail">{(id) => <Input id={id} value={invite.email} disabled />}</Field>
        <Field label="Seu nome">{(id) => <Input id={id} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />}</Field>
        <Field label="Senha" hint={`Pelo menos ${PASSWORD_MIN} caracteres.`}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Button type="submit" className="w-full" size="lg" loading={accept.isPending}>
          Criar conta e entrar na equipe
        </Button>
      </form>
    </AuthShell>
  );
}
