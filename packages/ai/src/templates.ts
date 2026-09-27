import type {
  AiEmojiUsage,
  AiResponseLength,
  AiTone,
  BusinessTemplateKey,
  FeatureFlagKey,
} from '@botsaas/shared';
import type { ToolName } from './tools/catalog';

/**
 * Templates de negócio = CONFIGURAÇÃO, não código específico por cliente.
 * Aplicar um template copia estes padrões para a empresa (tools, funil, campos, FAQ sugerido);
 * depois tudo é editável pelo painel sem alterar código.
 */

export interface TemplateLeadStage {
  key: string;
  name: string;
  color: string;
  isWon?: boolean;
  isLost?: boolean;
}

export interface TemplateCustomField {
  target: 'CONTACT' | 'LEAD';
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'SELECT' | 'BOOLEAN' | 'DATE';
  options?: string[];
  collectByAgent: boolean;
  agentHint?: string;
}

export interface TemplateProductAttribute {
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'SELECT' | 'BOOLEAN';
  options?: string[];
}

export interface BusinessTemplate {
  key: BusinessTemplateKey;
  name: string;
  description: string;
  /** Regras específicas do segmento (camada SEGMENT TEMPLATE do prompt). */
  segmentPrompt: string;
  tools: ToolName[];
  leadStages: TemplateLeadStage[];
  customFields: TemplateCustomField[];
  suggestedFaqs: { question: string; answer: string }[];
  catalog: {
    services: boolean;
    products: boolean;
    productLabel?: string;
    productAttributes?: TemplateProductAttribute[];
  };
  features: FeatureFlagKey[];
  onboardingHints: string[];
  agentDefaults: {
    agentName: string;
    tone: AiTone;
    responseLength: AiResponseLength;
    emojiUsage: AiEmojiUsage;
    greetingMessage: string;
  };
}

export const DEFAULT_LEAD_STAGES: TemplateLeadStage[] = [
  { key: 'NOVO', name: 'Novo', color: '#64748b' },
  { key: 'EM_ATENDIMENTO', name: 'Em atendimento', color: '#0ea5e9' },
  { key: 'QUALIFICADO', name: 'Qualificado', color: '#8b5cf6' },
  { key: 'PROPOSTA', name: 'Proposta', color: '#f59e0b' },
  { key: 'FECHADO', name: 'Fechado', color: '#16a34a', isWon: true },
  { key: 'PERDIDO', name: 'Perdido', color: '#dc2626', isLost: true },
];

const BASE_TOOLS: ToolName[] = [
  'get_company_information',
  'search_knowledge',
  'get_business_hours',
  'get_contact',
  'update_contact',
  'create_contact_note',
  'save_contact_memory',
  'update_lead_stage',
  'update_lead_qualification',
  'request_human_handoff',
];

const CALENDAR_TOOLS: ToolName[] = [
  'get_available_appointments',
  'create_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'list_contact_appointments',
];

const BASE_FEATURES: FeatureFlagKey[] = ['AI_AGENT', 'CRM'];

export const BUSINESS_TEMPLATES: Record<BusinessTemplateKey, BusinessTemplate> = {
  GENERAL: {
    key: 'GENERAL',
    name: 'Geral',
    description: 'Atendimento genérico para qualquer negócio local.',
    segmentPrompt:
      'Você atende clientes de um negócio local. Tire dúvidas sobre produtos, serviços, horários e localização, e encaminhe para a equipe o que não puder resolver.',
    tools: [...BASE_TOOLS, 'search_services', 'search_products'],
    leadStages: DEFAULT_LEAD_STAGES,
    customFields: [
      {
        target: 'LEAD',
        key: 'interesse',
        label: 'Interesse',
        type: 'TEXT',
        collectByAgent: true,
        agentHint: 'o que o cliente procura',
      },
    ],
    suggestedFaqs: [
      { question: 'Quais formas de pagamento vocês aceitam?', answer: '' },
      { question: 'Vocês emitem nota fiscal?', answer: '' },
    ],
    catalog: { services: true, products: true },
    features: [...BASE_FEATURES],
    onboardingHints: ['Cadastre os principais produtos/serviços e as perguntas mais frequentes.'],
    agentDefaults: {
      agentName: 'Assistente',
      tone: 'FRIENDLY',
      responseLength: 'SHORT',
      emojiUsage: 'MODERATE',
      greetingMessage: 'Olá! Como posso ajudar?',
    },
  },
  CLINIC: {
    key: 'CLINIC',
    name: 'Clínica / Consultório',
    description:
      'Atendimento ADMINISTRATIVO: serviços, preços autorizados, agenda, remarcação e cancelamento.',
    segmentPrompt: [
      'Você é a recepção virtual de uma clínica. Seu papel é EXCLUSIVAMENTE administrativo:',
      'apresentar serviços, informar preços autorizados, horários, endereço, e cuidar de agendamentos, remarcações e cancelamentos.',
      'Você NÃO é profissional de saúde: nunca faça diagnóstico, não interprete sintomas, exames ou resultados, não indique medicamentos, doses ou tratamentos e não diga se um procedimento é adequado para a pessoa.',
      'Perguntas clínicas devem ser encaminhadas: ofereça agendar uma avaliação com um profissional ou transfira para a equipe com request_human_handoff.',
      'Em sinais de urgência ou emergência (dor intensa, falta de ar, sangramento, desmaio, pensamentos de autolesão), oriente a procurar imediatamente um pronto-socorro ou ligar 192 (SAMU) e encaminhe para humano.',
      'Trate dados de saúde com discrição: não peça detalhes clínicos desnecessários e não os registre como memória.',
    ].join('\n'),
    tools: [...BASE_TOOLS, 'search_services', ...CALENDAR_TOOLS],
    leadStages: DEFAULT_LEAD_STAGES,
    customFields: [
      {
        target: 'LEAD',
        key: 'procedimento',
        label: 'Procedimento de interesse',
        type: 'TEXT',
        collectByAgent: true,
        agentHint: 'qual serviço/procedimento o paciente procura',
      },
      {
        target: 'LEAD',
        key: 'tipo_consulta',
        label: 'Primeira consulta ou retorno',
        type: 'SELECT',
        options: ['Primeira consulta', 'Retorno'],
        collectByAgent: true,
      },
      {
        target: 'LEAD',
        key: 'disponibilidade',
        label: 'Disponibilidade',
        type: 'TEXT',
        collectByAgent: true,
        agentHint: 'dias/períodos preferidos',
      },
      {
        target: 'CONTACT',
        key: 'convenio',
        label: 'Convênio',
        type: 'TEXT',
        collectByAgent: false,
      },
    ],
    suggestedFaqs: [
      { question: 'Vocês atendem convênio?', answer: '' },
      { question: 'Qual a política de cancelamento?', answer: '' },
      { question: 'Preciso de preparo para o procedimento?', answer: '' },
    ],
    catalog: { services: true, products: false },
    features: [...BASE_FEATURES, 'CALENDAR'],
    onboardingHints: [
      'Informe quais preços podem ser divulgados pelo agente.',
      'Defina a duração de cada procedimento para a agenda.',
    ],
    agentDefaults: {
      agentName: 'Recepção',
      tone: 'FRIENDLY',
      responseLength: 'SHORT',
      emojiUsage: 'NEVER',
      greetingMessage: 'Olá! Sou a recepção virtual. Como posso ajudar?',
    },
  },
  BARBERSHOP_BEAUTY: {
    key: 'BARBERSHOP_BEAUTY',
    name: 'Barbearia / Salão de beleza',
    description: 'Serviços, preços e agendamento de horários.',
    segmentPrompt:
      'Você atende uma barbearia/salão de beleza. Ajude o cliente a escolher serviços, informe preços e duração cadastrados e faça agendamentos. Seja prático: ofereça poucos horários por vez.',
    tools: [...BASE_TOOLS, 'search_services', 'search_products', ...CALENDAR_TOOLS],
    leadStages: DEFAULT_LEAD_STAGES,
    customFields: [
      {
        target: 'CONTACT',
        key: 'profissional_preferido',
        label: 'Profissional preferido',
        type: 'TEXT',
        collectByAgent: true,
      },
    ],
    suggestedFaqs: [
      { question: 'Precisa agendar ou atende por ordem de chegada?', answer: '' },
      { question: 'Quais formas de pagamento?', answer: '' },
    ],
    catalog: { services: true, products: true, productLabel: 'Produtos à venda' },
    features: [...BASE_FEATURES, 'CALENDAR'],
    onboardingHints: ['Cadastre serviços com duração para a agenda funcionar.'],
    agentDefaults: {
      agentName: 'Atendimento',
      tone: 'CASUAL',
      responseLength: 'SHORT',
      emojiUsage: 'MODERATE',
      greetingMessage: 'Fala! Quer agendar um horário?',
    },
  },
  RESTAURANT: {
    key: 'RESTAURANT',
    name: 'Restaurante / Delivery',
    description: 'Cardápio, preços, horário, endereço, retirada e entrega.',
    segmentPrompt: [
      'Você atende um restaurante. Informe cardápio, preços e disponibilidade conforme o catálogo, horários, endereço, opções de retirada/entrega e taxas cadastradas.',
      'Pedidos ainda não são registrados automaticamente: quando o cliente quiser fazer um pedido, colete itens e endereço de forma organizada e encaminhe para a equipe com request_human_handoff, a menos que as instruções da empresa digam outra coisa.',
      'Nunca confirme tempo de entrega ou taxa que não esteja na base de conhecimento.',
    ].join('\n'),
    tools: [...BASE_TOOLS, 'search_products'],
    leadStages: DEFAULT_LEAD_STAGES,
    customFields: [
      {
        target: 'CONTACT',
        key: 'endereco_entrega',
        label: 'Endereço de entrega',
        type: 'TEXT',
        collectByAgent: true,
      },
    ],
    suggestedFaqs: [
      { question: 'Qual a taxa de entrega?', answer: '' },
      { question: 'Qual o tempo médio de entrega?', answer: '' },
      { question: 'Tem opção vegetariana?', answer: '' },
    ],
    catalog: {
      services: false,
      products: true,
      productLabel: 'Cardápio',
      productAttributes: [
        { key: 'vegetariano', label: 'Vegetariano', type: 'BOOLEAN' },
        { key: 'serve_pessoas', label: 'Serve (pessoas)', type: 'NUMBER' },
      ],
    },
    features: [...BASE_FEATURES],
    onboardingHints: [
      'Cadastre o cardápio como produtos (categoria = seção do cardápio).',
      'Informe taxas e áreas de entrega na base de conhecimento.',
    ],
    agentDefaults: {
      agentName: 'Atendimento',
      tone: 'FRIENDLY',
      responseLength: 'SHORT',
      emojiUsage: 'MODERATE',
      greetingMessage: 'Olá! Quer ver o cardápio de hoje?',
    },
  },
  RETAIL_STORE: {
    key: 'RETAIL_STORE',
    name: 'Loja / Varejo',
    description: 'Produtos, preços, estoque, formas de pagamento e retirada.',
    segmentPrompt:
      'Você atende uma loja. Ajude o cliente a encontrar produtos do catálogo, informe preços e disponibilidade reais e explique políticas de troca, pagamento e entrega cadastradas.',
    tools: [...BASE_TOOLS, 'search_products'],
    leadStages: DEFAULT_LEAD_STAGES,
    customFields: [
      {
        target: 'LEAD',
        key: 'produto_interesse',
        label: 'Produto de interesse',
        type: 'TEXT',
        collectByAgent: true,
      },
    ],
    suggestedFaqs: [
      { question: 'Qual a política de trocas?', answer: '' },
      { question: 'Vocês entregam?', answer: '' },
    ],
    catalog: { services: false, products: true },
    features: [...BASE_FEATURES],
    onboardingHints: ['Ative controle de estoque apenas se ele for mantido atualizado.'],
    agentDefaults: {
      agentName: 'Atendimento',
      tone: 'FRIENDLY',
      responseLength: 'SHORT',
      emojiUsage: 'MODERATE',
      greetingMessage: 'Olá! Procurando algum produto?',
    },
  },
  REAL_ESTATE: {
    key: 'REAL_ESTATE',
    name: 'Imobiliária',
    description: 'Imóveis, qualificação de interessados e agendamento de visitas.',
    segmentPrompt: [
      'Você atende uma imobiliária. Entenda o que o cliente procura (compra ou aluguel, região, tipo, dormitórios, faixa de preço) de forma natural, sem interrogatório.',
      'Apresente somente imóveis retornados por search_products e ofereça agendar visita.',
      'Não prometa condições de financiamento, descontos ou aprovação de crédito — encaminhe para um corretor.',
    ].join('\n'),
    tools: [...BASE_TOOLS, 'search_products', ...CALENDAR_TOOLS],
    leadStages: [
      { key: 'NOVO', name: 'Novo', color: '#64748b' },
      { key: 'EM_ATENDIMENTO', name: 'Em atendimento', color: '#0ea5e9' },
      { key: 'QUALIFICADO', name: 'Qualificado', color: '#8b5cf6' },
      { key: 'VISITA_AGENDADA', name: 'Visita agendada', color: '#06b6d4' },
      { key: 'PROPOSTA', name: 'Proposta', color: '#f59e0b' },
      { key: 'FECHADO', name: 'Fechado', color: '#16a34a', isWon: true },
      { key: 'PERDIDO', name: 'Perdido', color: '#dc2626', isLost: true },
    ],
    customFields: [
      {
        target: 'LEAD',
        key: 'finalidade',
        label: 'Compra ou aluguel',
        type: 'SELECT',
        options: ['Compra', 'Aluguel'],
        collectByAgent: true,
      },
      {
        target: 'LEAD',
        key: 'regiao',
        label: 'Região desejada',
        type: 'TEXT',
        collectByAgent: true,
      },
      {
        target: 'LEAD',
        key: 'orcamento',
        label: 'Orçamento (R$)',
        type: 'NUMBER',
        collectByAgent: true,
        agentHint: 'faixa de valor que o cliente pode pagar',
      },
      {
        target: 'LEAD',
        key: 'tipo_imovel',
        label: 'Tipo de imóvel',
        type: 'SELECT',
        options: ['Apartamento', 'Casa', 'Comercial', 'Terreno'],
        collectByAgent: true,
      },
      {
        target: 'LEAD',
        key: 'dormitorios',
        label: 'Dormitórios',
        type: 'NUMBER',
        collectByAgent: true,
      },
    ],
    suggestedFaqs: [
      { question: 'Quais documentos preciso para alugar?', answer: '' },
      { question: 'Vocês trabalham com financiamento?', answer: '' },
    ],
    catalog: {
      services: false,
      products: true,
      productLabel: 'Imóveis',
      productAttributes: [
        { key: 'finalidade', label: 'Finalidade', type: 'SELECT', options: ['Venda', 'Aluguel'] },
        {
          key: 'tipo',
          label: 'Tipo',
          type: 'SELECT',
          options: ['Apartamento', 'Casa', 'Comercial', 'Terreno'],
        },
        { key: 'bairro', label: 'Bairro', type: 'TEXT' },
        { key: 'cidade', label: 'Cidade', type: 'TEXT' },
        { key: 'dormitorios', label: 'Dormitórios', type: 'NUMBER' },
        { key: 'vagas', label: 'Vagas', type: 'NUMBER' },
        { key: 'area_m2', label: 'Área (m²)', type: 'NUMBER' },
      ],
    },
    features: [...BASE_FEATURES, 'CALENDAR'],
    onboardingHints: [
      'Cadastre imóveis como produtos com os atributos (bairro, dormitórios, finalidade).',
    ],
    agentDefaults: {
      agentName: 'Corretor virtual',
      tone: 'FRIENDLY',
      responseLength: 'SHORT',
      emojiUsage: 'NEVER',
      greetingMessage: 'Olá! Está procurando imóvel para comprar ou alugar?',
    },
  },
  LOCAL_SERVICE: {
    key: 'LOCAL_SERVICE',
    name: 'Serviços locais / Oficina / Academia',
    description: 'Prestadores de serviço: orçamentos, agendamentos e dúvidas.',
    segmentPrompt:
      'Você atende uma empresa de serviços. Explique os serviços cadastrados, informe preços apenas quando autorizados e agende atendimentos. Orçamentos personalizados devem ser encaminhados para a equipe.',
    tools: [...BASE_TOOLS, 'search_services', ...CALENDAR_TOOLS],
    leadStages: DEFAULT_LEAD_STAGES,
    customFields: [
      {
        target: 'LEAD',
        key: 'servico',
        label: 'Serviço desejado',
        type: 'TEXT',
        collectByAgent: true,
      },
      {
        target: 'LEAD',
        key: 'urgencia',
        label: 'Urgência',
        type: 'SELECT',
        options: ['Baixa', 'Média', 'Alta'],
        collectByAgent: true,
      },
    ],
    suggestedFaqs: [{ question: 'Vocês fazem orçamento sem compromisso?', answer: '' }],
    catalog: { services: true, products: false },
    features: [...BASE_FEATURES, 'CALENDAR'],
    onboardingHints: ['Informe quais serviços exigem visita/avaliação antes do orçamento.'],
    agentDefaults: {
      agentName: 'Atendimento',
      tone: 'OBJECTIVE',
      responseLength: 'SHORT',
      emojiUsage: 'NEVER',
      greetingMessage: 'Olá! Em que podemos ajudar?',
    },
  },
};

export function getBusinessTemplate(key: BusinessTemplateKey): BusinessTemplate {
  return BUSINESS_TEMPLATES[key];
}

export function listBusinessTemplates(): BusinessTemplate[] {
  return Object.values(BUSINESS_TEMPLATES);
}
