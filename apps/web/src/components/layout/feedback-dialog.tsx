'use client';

import { FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABELS, type FeedbackCategory } from '@botsaas/shared';
import { useMutation } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const pathname = usePathname();
  const [category, setCategory] = useState<FeedbackCategory>('SUGGESTION');
  const [message, setMessage] = useState('');
  const send = useMutation({
    mutationFn: () => api.post('/app/support/feedback', { category, message, page: pathname }),
    onSuccess: () => {
      onOpenChange(false);
      setMessage('');
      toast.success('Obrigado! Seu feedback chegou para a equipe WebZen.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Enviar feedback"
      description="Conte o que funcionou, o que atrapalhou ou o que falta. Para problemas urgentes, abra um chamado em Suporte."
      footer={
        <Button onClick={() => send.mutate()} loading={send.isPending} disabled={message.trim().length < 3}>
          Enviar feedback
        </Button>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Tipo de feedback" className="flex flex-wrap gap-2">
          {FEEDBACK_CATEGORIES.map((item) => (
            <button
              key={item}
              role="radio"
              aria-checked={category === item}
              onClick={() => setCategory(item)}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors',
                category === item ? 'bg-brand-600 text-white ring-brand-600' : 'text-slate-600 ring-border hover:bg-slate-50',
              )}
            >
              {FEEDBACK_CATEGORY_LABELS[item]}
            </button>
          ))}
        </div>
        <Field label="Mensagem">{(id) => <Textarea id={id} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
