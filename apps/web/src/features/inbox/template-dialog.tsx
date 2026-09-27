'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: { type?: string; text?: string }[] | null;
}

export function TemplateDialog({ open, onOpenChange, conversationId, onSent }: { open: boolean; onOpenChange: (open: boolean) => void; conversationId: string; onSent: () => void }) {
  const toast = useToast();
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/app/integrations/whatsapp/templates'), enabled: open });
  const approved = (templates.data ?? []).filter((template) => template.status === 'APPROVED');
  const [selected, setSelected] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const template = approved.find((item) => `${item.name}|${item.language}` === selected);
  const body = template?.components?.find((component) => component.type?.toUpperCase() === 'BODY')?.text ?? '';
  const count = useMemo(() => new Set(body.match(/\{\{\d+\}\}/g) ?? []).size, [body]);
  const preview = body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => params[Number(index) - 1] || `{{${index}}}`);

  const send = useMutation({
    mutationFn: () => api.post(`/app/conversations/${conversationId}/template`, { templateName: template?.name, languageCode: template?.language, bodyParameters: params.slice(0, count) }),
    onSuccess: () => {
      toast.success('Template enviado.');
      onSent();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Enviar template aprovado"
      description="Fora da janela de 24h, a Meta só permite mensagens de template aprovadas."
      footer={
        <Button onClick={() => send.mutate()} disabled={!template} loading={send.isPending}>
          Enviar
        </Button>
      }
    >
      {approved.length === 0 && !templates.isLoading ? (
        <EmptyState title="Nenhum template aprovado" description="Sincronize os templates em Integrações → WhatsApp." />
      ) : (
        <div className="space-y-4">
          <Field label="Template">
            {(id) => (
              <Select id={id} value={selected} onChange={(event) => { setSelected(event.target.value); setParams([]); }}>
                <option value="">Selecione…</option>
                {approved.map((item) => (
                  <option key={item.id} value={`${item.name}|${item.language}`}>
                    {item.name} ({item.language})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {Array.from({ length: count }).map((_, index) => (
            <Field key={index} label={`Variável {{${index + 1}}}`}>
              {(id) => (
                <Input id={id} value={params[index] ?? ''} onChange={(event) => setParams((current) => { const next = [...current]; next[index] = event.target.value; return next; })} />
              )}
            </Field>
          ))}
          {template ? <div className="rounded-lg bg-brand-50 p-3 text-sm text-slate-700">{preview}</div> : null}
        </div>
      )}
    </Dialog>
  );
}
