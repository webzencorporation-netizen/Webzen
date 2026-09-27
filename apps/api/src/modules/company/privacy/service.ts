import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  // Neutraliza fórmulas em planilhas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n;]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');
}

export async function exportContactsCsv(scope: CompanyScope) {
  const contacts = await scope.db.contact.findMany({
    where: { source: { not: 'test' } },
    include: {
      tags: { include: { tag: { select: { name: true } } } },
      assignee: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50_000,
  });
  await audit(scope, {
    action: 'data.contacts_exported',
    resourceType: 'Contact',
    metadata: { count: contacts.length },
  });
  return toCsv(
    [
      'id',
      'nome',
      'telefone',
      'email',
      'origem',
      'status',
      'responsavel',
      'etiquetas',
      'ultima_interacao',
      'criado_em',
      'campos',
    ],
    contacts.map((contact) => [
      contact.id,
      contact.name,
      contact.phone,
      contact.email,
      contact.source,
      contact.status,
      contact.assignee?.name,
      contact.tags.map(({ tag }) => tag.name).join('|'),
      contact.lastInteractionAt,
      contact.createdAt,
      contact.customFields,
    ]),
  );
}

export async function exportLeadsCsv(scope: CompanyScope) {
  const leads = await scope.db.lead.findMany({
    include: {
      contact: { select: { name: true, phone: true } },
      stage: { select: { name: true } },
      assignee: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50_000,
  });
  await audit(scope, {
    action: 'data.crm_exported',
    resourceType: 'Lead',
    metadata: { count: leads.length },
  });
  return toCsv(
    [
      'id',
      'contato',
      'telefone',
      'etapa',
      'titulo',
      'valor_centavos',
      'responsavel',
      'qualificacao',
      'criado_em',
      'fechado_em',
    ],
    leads.map((lead) => [
      lead.id,
      lead.contact.name,
      lead.contact.phone,
      lead.stage.name,
      lead.title,
      lead.valueCents,
      lead.assignee?.name,
      lead.qualification,
      lead.createdAt,
      lead.closedAt,
    ]),
  );
}

export async function exportUsageCsv(scope: CompanyScope) {
  const records = await scope.db.usageRecord.findMany({
    orderBy: { occurredAt: 'desc' },
    take: 50_000,
  });
  return toCsv(
    [
      'data',
      'tipo',
      'modelo',
      'tokens_entrada',
      'tokens_saida',
      'cache_leitura',
      'cache_escrita',
      'custo_usd',
      'conversa',
      'teste',
    ],
    records.map((record) => [
      record.occurredAt,
      record.kind,
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.cacheReadTokens,
      record.cacheWriteTokens,
      record.costUsd.toString(),
      record.conversationId,
      record.isTest,
    ]),
  );
}
