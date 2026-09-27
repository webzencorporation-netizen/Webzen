import { z } from 'zod';

/**
 * Contrato das tools visível ao modelo (nome, descrição e schema de entrada).
 * As implementações (handlers) ficam no backend (apps/api/src/modules/agent/tools) e sempre
 * operam no escopo da empresa da conversa — o modelo nunca escolhe a empresa.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD');
const isoDateTime = z
  .string()
  .min(16)
  .describe('Data e hora ISO 8601 com fuso, ex.: 2026-10-01T14:30:00-03:00');

export const TOOL_INPUT_SCHEMAS = {
  get_company_information: z.object({}).strict(),
  search_knowledge: z
    .object({
      query: z
        .string()
        .min(2)
        .max(200)
        .describe('Pergunta ou termos a pesquisar na base de conhecimento'),
    })
    .strict(),
  search_products: z
    .object({
      query: z.string().max(200).optional().describe('Termos de busca (nome, categoria)'),
      category: z.string().max(100).optional(),
      filters: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Filtros por atributos (ex.: {"bairro":"Centro","dormitorios":2})'),
    })
    .strict(),
  search_services: z
    .object({ query: z.string().max(200).optional().describe('Nome ou tipo do serviço') })
    .strict(),
  get_business_hours: z
    .object({ date: isoDate.optional().describe('Data específica (feriados/horário especial)') })
    .strict(),
  get_contact: z.object({}).strict(),
  update_contact: z
    .object({
      name: z.string().min(1).max(120).optional(),
      email: z.email().optional(),
      customFields: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe(
          'Campos personalizados configurados pela empresa (use somente as chaves informadas no contexto)',
        ),
    })
    .strict(),
  create_contact_note: z.object({ note: z.string().min(3).max(1000) }).strict(),
  save_contact_memory: z
    .object({
      key: z
        .enum([
          'preferred_name',
          'preferences',
          'service_interest',
          'last_purchase',
          'last_visit',
          'observation',
        ])
        .describe('Categoria da memória'),
      value: z.string().min(1).max(300),
    })
    .strict(),
  update_lead_stage: z
    .object({
      stageKey: z.string().min(1).max(50).describe('Chave da etapa do funil (ver contexto)'),
      reason: z.string().max(300).optional(),
    })
    .strict(),
  update_lead_qualification: z
    .object({
      fields: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .describe('Campos de qualificação coletados (chaves listadas no contexto)'),
    })
    .strict(),
  get_available_appointments: z
    .object({
      serviceId: z.string().uuid().optional().describe('ID do serviço (obtido em search_services)'),
      date: isoDate.describe('Dia desejado (fuso da empresa)'),
      days: z
        .number()
        .int()
        .min(1)
        .max(7)
        .optional()
        .describe('Quantos dias a partir de `date` (padrão 1)'),
    })
    .strict(),
  create_appointment: z
    .object({
      serviceId: z.string().uuid().optional(),
      startAt: isoDateTime,
      notes: z.string().max(500).optional(),
      customerConfirmed: z
        .literal(true)
        .describe('Somente true após o cliente confirmar explicitamente data, hora e serviço'),
    })
    .strict(),
  reschedule_appointment: z
    .object({
      appointmentId: z.string().uuid(),
      newStartAt: isoDateTime,
      customerConfirmed: z
        .literal(true)
        .describe('Somente true após o cliente confirmar explicitamente o novo horário'),
    })
    .strict(),
  cancel_appointment: z
    .object({
      appointmentId: z.string().uuid(),
      reason: z.string().max(300).optional(),
      customerConfirmed: z
        .literal(true)
        .describe('Somente true após o cliente confirmar explicitamente o cancelamento'),
    })
    .strict(),
  list_contact_appointments: z.object({}).strict(),
  request_human_handoff: z
    .object({
      reason: z.string().min(3).max(300).describe('Motivo objetivo do encaminhamento'),
      urgent: z.boolean().optional(),
    })
    .strict(),
} as const;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;
export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_INPUT_SCHEMAS)[N]>;

export const TOOL_NAMES = Object.keys(TOOL_INPUT_SCHEMAS) as ToolName[];

export interface ToolMetadata {
  /** Rótulo amigável para o painel (linguagem comercial). */
  label: string;
  /** Descrição enviada ao modelo. */
  description: string;
  mutating: boolean;
  category: 'info' | 'catalog' | 'contact' | 'crm' | 'calendar' | 'handoff';
}

export const TOOL_METADATA: Record<ToolName, ToolMetadata> = {
  get_company_information: {
    label: 'Consultar dados da empresa',
    description:
      'Retorna dados oficiais da empresa: nome, descrição, endereço, telefone, site e formas de contato.',
    mutating: false,
    category: 'info',
  },
  search_knowledge: {
    label: 'Pesquisar base de conhecimento',
    description:
      'Pesquisa a base de conhecimento da empresa (FAQ, políticas, informações). Use antes de responder perguntas sobre a empresa que não estejam no contexto.',
    mutating: false,
    category: 'info',
  },
  search_products: {
    label: 'Pesquisar produtos/catálogo',
    description:
      'Pesquisa produtos ativos (preço autorizado, disponibilidade/estoque e atributos). Nunca informe preço que não venha desta tool.',
    mutating: false,
    category: 'catalog',
  },
  search_services: {
    label: 'Pesquisar serviços',
    description:
      'Pesquisa serviços ativos com preço autorizado e duração. Nunca informe preço que não venha desta tool.',
    mutating: false,
    category: 'catalog',
  },
  get_business_hours: {
    label: 'Consultar horário de funcionamento',
    description:
      'Retorna o horário de funcionamento semanal, feriados próximos e se a empresa está aberta agora.',
    mutating: false,
    category: 'info',
  },
  get_contact: {
    label: 'Consultar dados do cliente',
    description: 'Retorna os dados cadastrados do cliente desta conversa.',
    mutating: false,
    category: 'contact',
  },
  update_contact: {
    label: 'Atualizar dados do cliente',
    description:
      'Atualiza nome, e-mail ou campos personalizados do cliente desta conversa, quando ele informar.',
    mutating: true,
    category: 'contact',
  },
  create_contact_note: {
    label: 'Registrar observação',
    description:
      'Registra uma observação interna sobre o cliente para a equipe (não é enviada ao cliente).',
    mutating: true,
    category: 'contact',
  },
  save_contact_memory: {
    label: 'Lembrar informação do cliente',
    description:
      'Guarda uma informação útil e duradoura sobre o cliente (preferência, interesse). Não use para dados sensíveis (documentos, saúde, dados financeiros) nem para informações triviais.',
    mutating: true,
    category: 'contact',
  },
  update_lead_stage: {
    label: 'Mover lead no funil',
    description: 'Move o lead do cliente para outra etapa do funil de vendas.',
    mutating: true,
    category: 'crm',
  },
  update_lead_qualification: {
    label: 'Registrar qualificação do lead',
    description: 'Registra campos de qualificação coletados naturalmente durante a conversa.',
    mutating: true,
    category: 'crm',
  },
  get_available_appointments: {
    label: 'Consultar horários disponíveis',
    description:
      'Lista horários livres para agendamento. Nunca ofereça horários que não venham desta tool.',
    mutating: false,
    category: 'calendar',
  },
  create_appointment: {
    label: 'Criar agendamento',
    description:
      'Cria um agendamento para o cliente desta conversa. Antes, confirme com o cliente serviço, data e hora exatos; só então chame com customerConfirmed=true.',
    mutating: true,
    category: 'calendar',
  },
  reschedule_appointment: {
    label: 'Remarcar agendamento',
    description: 'Remarca um agendamento do cliente. Confirme o novo horário com o cliente antes.',
    mutating: true,
    category: 'calendar',
  },
  cancel_appointment: {
    label: 'Cancelar agendamento',
    description:
      'Cancela um agendamento do cliente. Antes, pergunte "Você deseja realmente cancelar ...?" e só chame após confirmação explícita.',
    mutating: true,
    category: 'calendar',
  },
  list_contact_appointments: {
    label: 'Listar agendamentos do cliente',
    description: 'Lista os próximos agendamentos do cliente desta conversa.',
    mutating: false,
    category: 'calendar',
  },
  request_human_handoff: {
    label: 'Encaminhar para atendente',
    description:
      'Transfere a conversa para um atendente humano. Use quando o cliente pedir, em reclamações sérias, quando não houver informação suficiente, em orçamentos especiais, questões clínicas/jurídicas ou ações sensíveis.',
    mutating: true,
    category: 'handoff',
  },
};

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
