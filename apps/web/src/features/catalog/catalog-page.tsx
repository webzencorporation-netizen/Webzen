'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, Skeleton, Switch, Table, Tabs, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import { useCan } from '@/lib/session';

interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  priceCents: number | null;
  priceNote: string | null;
  priceVisibleToAi: boolean;
  isActive: boolean;
  durationMinutes?: number | null;
  sku?: string | null;
  trackStock?: boolean;
  stockQuantity?: number | null;
  attributes?: Record<string, string | number | boolean | null> | null;
}

interface TemplateInfo {
  catalog: { services: boolean; products: boolean; productLabel?: string; productAttributes?: { key: string; label: string; type: string; options?: string[] }[] };
}

type Kind = 'services' | 'products';

function ItemDialog({ kind, item, open, onOpenChange, attributes }: { kind: Kind; item: CatalogItem | null; open: boolean; onOpenChange: (open: boolean) => void; attributes: NonNullable<TemplateInfo['catalog']['productAttributes']> }) {
  const client = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<CatalogItem>(
    item ?? { id: '', name: '', description: null, category: null, priceCents: null, priceNote: null, priceVisibleToAi: true, isActive: true, durationMinutes: 30, trackStock: false, stockQuantity: null, attributes: {} },
  );
  const [price, setPrice] = useState(item?.priceCents !== null && item?.priceCents !== undefined ? (item.priceCents / 100).toFixed(2).replace('.', ',') : '');
  const save = useMutation({
    mutationFn: () => {
      const priceCents = price.trim() === '' ? null : Math.round(Number(price.replace(/\./g, '').replace(',', '.')) * 100);
      const body = {
        name: form.name,
        description: form.description,
        category: form.category,
        priceCents: Number.isFinite(priceCents) ? priceCents : null,
        priceNote: form.priceNote,
        priceVisibleToAi: form.priceVisibleToAi,
        isActive: form.isActive,
        ...(kind === 'services' ? { durationMinutes: form.durationMinutes } : { sku: form.sku, trackStock: form.trackStock, stockQuantity: form.trackStock ? form.stockQuantity : null, attributes: form.attributes }),
      };
      return item ? api.patch(`/app/catalog/${kind}/${item.id}`, body) : api.post(`/app/catalog/${kind}`, body);
    },
    onSuccess: () => {
      toast.success('Salvo.');
      void client.invalidateQueries({ queryKey: ['catalog', kind] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const set = <K extends keyof CatalogItem>(key: K, value: CatalogItem[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={item ? 'Editar' : kind === 'services' ? 'Novo serviço' : 'Novo item'} size="lg" footer={<Button onClick={() => save.mutate()} disabled={form.name.trim().length < 2} loading={save.isPending}>Salvar</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome" className="md:col-span-2">{(id) => <Input id={id} value={form.name} onChange={(event) => set('name', event.target.value)} />}</Field>
        <Field label="Descrição" className="md:col-span-2" hint="O atendente usa este texto para explicar o item ao cliente.">{(id) => <Textarea id={id} value={form.description ?? ''} onChange={(event) => set('description', event.target.value || null)} />}</Field>
        <Field label="Categoria">{(id) => <Input id={id} value={form.category ?? ''} onChange={(event) => set('category', event.target.value || null)} />}</Field>
        {kind === 'services' ? (
          <Field label="Duração (minutos)">{(id) => <Input id={id} type="number" min={5} value={form.durationMinutes ?? ''} onChange={(event) => set('durationMinutes', event.target.value ? Number(event.target.value) : null)} />}</Field>
        ) : (
          <Field label="SKU / código">{(id) => <Input id={id} value={form.sku ?? ''} onChange={(event) => set('sku', event.target.value || null)} />}</Field>
        )}
        <Field label="Preço (R$)" hint="Deixe vazio se não houver preço fixo.">{(id) => <Input id={id} value={price} inputMode="decimal" placeholder="0,00" onChange={(event) => setPrice(event.target.value)} />}</Field>
        <Field label="Observação do preço" hint='Ex.: "a partir de", "sob avaliação".'>{(id) => <Input id={id} value={form.priceNote ?? ''} onChange={(event) => set('priceNote', event.target.value || null)} />}</Field>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 md:col-span-2">
          <span className="text-sm">A IA pode informar o preço ao cliente</span>
          <Switch checked={form.priceVisibleToAi} onCheckedChange={(value) => set('priceVisibleToAi', value)} label="IA pode informar preço" />
        </div>
        {kind === 'products' ? (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm">Controlar estoque</span>
              <Switch checked={Boolean(form.trackStock)} onCheckedChange={(value) => set('trackStock', value)} label="Controlar estoque" />
            </div>
            {form.trackStock ? <Field label="Quantidade em estoque">{(id) => <Input id={id} type="number" min={0} value={form.stockQuantity ?? ''} onChange={(event) => set('stockQuantity', event.target.value === '' ? null : Number(event.target.value))} />}</Field> : <div />}
            {attributes.map((attribute) => (
              <Field key={attribute.key} label={attribute.label}>
                {(id) =>
                  attribute.type === 'SELECT' ? (
                    <Select id={id} value={String(form.attributes?.[attribute.key] ?? '')} onChange={(event) => set('attributes', { ...form.attributes, [attribute.key]: event.target.value || null })}>
                      <option value="">—</option>
                      {attribute.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                    </Select>
                  ) : attribute.type === 'BOOLEAN' ? (
                    <Select id={id} value={form.attributes?.[attribute.key] === true ? 'true' : form.attributes?.[attribute.key] === false ? 'false' : ''} onChange={(event) => set('attributes', { ...form.attributes, [attribute.key]: event.target.value === '' ? null : event.target.value === 'true' })}>
                      <option value="">—</option><option value="true">Sim</option><option value="false">Não</option>
                    </Select>
                  ) : (
                    <Input id={id} type={attribute.type === 'NUMBER' ? 'number' : 'text'} value={String(form.attributes?.[attribute.key] ?? '')} onChange={(event) => set('attributes', { ...form.attributes, [attribute.key]: event.target.value === '' ? null : attribute.type === 'NUMBER' ? Number(event.target.value) : event.target.value })} />
                  )
                }
              </Field>
            ))}
          </>
        ) : null}
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 md:col-span-2">
          <span className="text-sm">Ativo (visível para a IA)</span>
          <Switch checked={form.isActive} onCheckedChange={(value) => set('isActive', value)} label="Ativo" />
        </div>
      </div>
    </Dialog>
  );
}

export function CatalogPage() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const template = useQuery({ queryKey: ['template'], queryFn: () => api.get<TemplateInfo>('/app/company/template') });
  const [kind, setKind] = useState<Kind>('services');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  const items = useQuery({ queryKey: ['catalog', kind], queryFn: () => api.get<Paginated<CatalogItem>>(`/app/catalog/${kind}`, { pageSize: 100 }) });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/app/catalog/${kind}/${id}`),
    onSuccess: () => { setDeleting(null); void client.invalidateQueries({ queryKey: ['catalog', kind] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const productLabel = template.data?.catalog.productLabel ?? 'Produtos';
  const tabs = [{ value: 'services', label: 'Serviços' }, { value: 'products', label: productLabel }];

  return (
    <PageContainer>
      <PageHeader
        title="Produtos e serviços"
        description="O atendente só informa preços e itens cadastrados aqui."
        actions={can('catalog:write') ? <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="h-4 w-4" /> Adicionar</Button> : null}
      />
      <Tabs value={kind} onValueChange={(value) => setKind(value as Kind)} items={tabs} className="mb-4" />
      <Card>
        {items.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !items.data || items.data.items.length === 0 ? (
          <EmptyState icon={Package} title="Nada cadastrado ainda" description="Cadastre itens para que a IA possa apresentá-los aos clientes." />
        ) : (
          <Table>
            <thead>
              <tr><Th>Nome</Th><Th>Categoria</Th><Th>Preço</Th>{kind === 'services' ? <Th>Duração</Th> : <Th>Estoque</Th>}<Th>Status</Th><Th /></tr>
            </thead>
            <tbody>
              {items.data.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <Td><p className="font-medium text-slate-900">{item.name}</p>{item.description ? <p className="line-clamp-1 text-xs text-muted">{item.description}</p> : null}</Td>
                  <Td>{item.category ?? '—'}</Td>
                  <Td>
                    {item.priceCents !== null ? formatMoneyCents(item.priceCents) : '—'}
                    {item.priceNote ? <span className="ml-1 text-xs text-muted">({item.priceNote})</span> : null}
                    {!item.priceVisibleToAi ? <Badge tone="amber" className="ml-2">IA não informa</Badge> : null}
                  </Td>
                  {kind === 'services' ? <Td>{item.durationMinutes ? `${item.durationMinutes} min` : '—'}</Td> : <Td>{item.trackStock ? (item.stockQuantity ?? 0) : 'Não controla'}</Td>}
                  <Td>{item.isActive ? <Badge tone="brand">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                  <Td className="text-right">
                    {can('catalog:write') ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(item); setDialogOpen(true); }} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(item)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {dialogOpen ? <ItemDialog key={editing?.id ?? 'new'} kind={kind} item={editing} open={dialogOpen} onOpenChange={setDialogOpen} attributes={template.data?.catalog.productAttributes ?? []} /> : null}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title="Excluir item?" description={`"${deleting?.name}" deixará de ser oferecido pela IA.`} confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </PageContainer>
  );
}
