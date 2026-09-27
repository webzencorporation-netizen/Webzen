'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FileText, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, Pagination, Skeleton, Switch } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { knowledgeTypeLabels } from '@/i18n/pt-BR';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Entry {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  isActive: boolean;
  documentId: string | null;
  updatedAt: string;
}
interface KnowledgeDocument {
  id: string;
  title: string;
  fileName: string | null;
  sizeBytes: number | null;
  status: string;
  error: string | null;
  createdAt: string;
  _count: { entries: number };
}

function EntryDialog({ entry, open, onOpenChange, suggestions }: { entry: Entry | null; open: boolean; onOpenChange: (open: boolean) => void; suggestions: string[] }) {
  const client = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState(entry?.type ?? 'FAQ');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [content, setContent] = useState(entry?.content ?? '');
  const save = useMutation({
    mutationFn: () => (entry ? api.patch(`/app/knowledge/entries/${entry.id}`, { type, title, content }) : api.post('/app/knowledge/entries', { type, title, content })),
    onSuccess: () => { toast.success('Conhecimento salvo.'); void client.invalidateQueries({ queryKey: ['knowledge'] }); onOpenChange(false); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={entry ? 'Editar conhecimento' : 'Adicionar conhecimento'} size="lg" footer={<Button onClick={() => save.mutate()} disabled={title.length < 2 || !content.trim()} loading={save.isPending}>Salvar</Button>}>
      <div className="space-y-4">
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={type} onChange={(event) => setType(event.target.value)}>
              {Object.entries(knowledgeTypeLabels).filter(([key]) => key !== 'DOCUMENT').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          )}
        </Field>
        <Field label={type === 'FAQ' ? 'Pergunta' : 'Título'}>{(id) => <Input id={id} value={title} onChange={(event) => setTitle(event.target.value)} list="faq-suggestions" />}</Field>
        <datalist id="faq-suggestions">{suggestions.map((question) => <option key={question} value={question} />)}</datalist>
        <Field label={type === 'FAQ' ? 'Resposta' : 'Conteúdo'} hint="Escreva de forma clara e completa: a IA usa exatamente estas informações.">
          {(id) => <Textarea id={id} value={content} onChange={(event) => setContent(event.target.value)} className="min-h-[160px]" />}
        </Field>
      </div>
    </Dialog>
  );
}

export function KnowledgePage() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [probe, setProbe] = useState('');
  const entries = useQuery({ queryKey: ['knowledge', search, type, page], queryFn: () => api.get<Paginated<Entry>>('/app/knowledge/entries', { search, type, page, pageSize: 20 }) });
  const documents = useQuery({ queryKey: ['knowledge-documents'], queryFn: () => api.get<KnowledgeDocument[]>('/app/knowledge/documents'), refetchInterval: 8000 });
  const template = useQuery({ queryKey: ['template'], queryFn: () => api.get<{ suggestedFaqs: { question: string }[] }>('/app/company/template') });
  const probeResults = useQuery({ queryKey: ['knowledge-probe', probe], queryFn: () => api.get<{ id: string; title: string; content: string; score: number }[]>('/app/knowledge/search', { q: probe }), enabled: probe.length >= 3 });

  const toggle = useMutation({ mutationFn: (entry: Entry) => api.patch(`/app/knowledge/entries/${entry.id}`, { isActive: !entry.isActive }), onSuccess: () => client.invalidateQueries({ queryKey: ['knowledge'] }) });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/app/knowledge/entries/${id}`), onSuccess: () => client.invalidateQueries({ queryKey: ['knowledge'] }), onError: (error) => toast.error(errorMessage(error)) });
  const removeDocument = useMutation({ mutationFn: (id: string) => api.delete(`/app/knowledge/documents/${id}`), onSuccess: () => client.invalidateQueries({ queryKey: ['knowledge-documents'] }) });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('title', file.name.replace(/\.[^.]+$/, ''));
      form.append('file', file);
      return api.upload('/app/knowledge/documents', form);
    },
    onSuccess: () => { toast.success('Documento enviado. O processamento leva alguns segundos.'); void client.invalidateQueries({ queryKey: ['knowledge-documents'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Base de conhecimento"
        description="Informações que o atendente consulta para responder. Ele nunca inventa o que não estiver aqui."
        actions={can('knowledge:write') ? (
          <>
            <input ref={fileInput} type="file" accept=".pdf,.txt,.md,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ''; }} />
            <Button variant="secondary" onClick={() => fileInput.current?.click()} loading={upload.isPending}><Upload className="h-4 w-4" /> Enviar documento</Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="h-4 w-4" /> Adicionar</Button>
          </>
        ) : null}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar" className="pl-9" aria-label="Buscar conhecimento" />
            </div>
            <Select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="sm:w-52" aria-label="Filtrar por tipo">
              <option value="">Todos os tipos</option>
              {Object.entries(knowledgeTypeLabels).filter(([key]) => key !== 'DOCUMENT').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </div>
          {entries.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !entries.data || entries.data.items.length === 0 ? (
            <EmptyState icon={BookOpen} title="Base vazia" description="Adicione perguntas frequentes, políticas e informações da empresa." />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {entries.data.items.map((entry) => (
                  <li key={entry.id} className="flex gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">{entry.title}</p>
                        <Badge>{knowledgeTypeLabels[entry.type]}</Badge>
                        {!entry.isActive ? <Badge tone="amber">Desativado</Badge> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{entry.content}</p>
                    </div>
                    {can('knowledge:write') ? (
                      <div className="flex shrink-0 items-start gap-1">
                        <Switch checked={entry.isActive} onCheckedChange={() => toggle.mutate(entry)} label="Ativo" />
                        <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(entry); setDialogOpen(true); }} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(entry.id)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Pagination page={entries.data.page} pageSize={entries.data.pageSize} total={entries.data.total} onPageChange={setPage} />
            </>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Testar busca" description="Veja o que a IA encontraria para uma pergunta." />
            <CardContent className="space-y-3">
              <Input value={probe} onChange={(event) => setProbe(event.target.value)} placeholder="Ex.: aceitam cartão?" aria-label="Pergunta de teste" />
              {probeResults.data?.map((hit) => (
                <div key={hit.id} className="rounded-lg bg-surface-muted p-2 text-xs">
                  <p className="font-medium">{hit.title} <span className="text-muted">· {hit.score.toFixed(3)}</span></p>
                  <p className="line-clamp-2 text-muted">{hit.content}</p>
                </div>
              ))}
              {probe.length >= 3 && probeResults.data?.length === 0 ? <p className="text-xs text-muted">Nada encontrado — a IA diria que não tem essa informação.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Documentos" description="PDF, TXT, MD ou CSV." />
            <ul className="divide-y divide-border">
              {(documents.data ?? []).map((document) => (
                <li key={document.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{document.title}</p>
                    <p className="text-xs text-muted">
                      {document.status === 'PROCESSED' ? `${document._count.entries} trechos` : document.status === 'FAILED' ? (document.error ?? 'Falhou') : 'Processando…'} · {formatDateTime(document.createdAt)}
                    </p>
                  </div>
                  {can('knowledge:write') ? <Button variant="ghost" size="icon-sm" onClick={() => removeDocument.mutate(document.id)} aria-label="Excluir documento"><Trash2 className="h-4 w-4 text-red-500" /></Button> : null}
                </li>
              ))}
              {documents.data?.length === 0 ? <li className="px-4 py-4 text-sm text-muted">Nenhum documento.</li> : null}
            </ul>
          </Card>
        </div>
      </div>
      {dialogOpen ? <EntryDialog key={editing?.id ?? 'new'} entry={editing} open={dialogOpen} onOpenChange={setDialogOpen} suggestions={(template.data?.suggestedFaqs ?? []).map((faq) => faq.question)} /> : null}
    </PageContainer>
  );
}
