'use client';

import { useQuery } from '@tanstack/react-query';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';

interface Preview {
  version: number;
  note: string;
  sections: { key: string; title: string; text: string; cached: boolean }[];
}

export function PromptPreviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const preview = useQuery({ queryKey: ['prompt-preview'], queryFn: () => api.get<Preview>('/app/ai/prompt-preview'), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Prompt final do atendente" description="Composição em camadas enviada à IA. Visível apenas para administradores." size="xl">
      {preview.isLoading || !preview.data ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">Versão {preview.data.version}. {preview.data.note}</p>
          {preview.data.sections.map((section) => (
            <section key={section.key} className="rounded-lg border border-border">
              <header className="flex items-center justify-between border-b border-border bg-surface-muted px-3 py-2 text-xs font-semibold">
                {section.title}
                <span className="font-normal text-muted">{section.cached ? 'estável (cache)' : 'por conversa'}</span>
              </header>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-[12px] leading-relaxed text-slate-700 scrollbar-thin">{section.text}</pre>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
