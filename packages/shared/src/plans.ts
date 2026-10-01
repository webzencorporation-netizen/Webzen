import type { BillingInterval, FeatureFlagKey, SubscriptionStatus, UsageMetric } from './enums';

/**
 * Catálogo padrão dos planos do WebZen: a ÚNICA definição de preços, limites e recursos no
 * código. O seed e a migração criam/atualizam a tabela `Plan` a partir daqui; em execução,
 * a tabela é a fonte da verdade (o administrador da plataforma pode ajustá-la sem deploy).
 * Nenhum outro arquivo deve repetir preço, limite ou "if (plan === 'PRO')".
 */
export type PlanLimits = Record<UsageMetric, number | null>;

export interface PlanDefinition {
  key: string;
  name: string;
  /** Uma linha para o card de preços. */
  tagline: string;
  description: string;
  /** Centavos de BRL. */
  priceMonthlyCents: number;
  /** Centavos de BRL por ano; nulo = sem opção anual. */
  priceYearlyCents: number | null;
  /** Nulo em uma métrica = ilimitado. */
  limits: PlanLimits;
  features: FeatureFlagKey[];
  highlight: boolean;
  sortOrder: number;
}

export const DEFAULT_PLANS: readonly PlanDefinition[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    tagline: 'Para pequenos negócios que querem começar a automatizar o atendimento.',
    description: 'Atendente com IA no WhatsApp, CRM, agenda e automações essenciais.',
    priceMonthlyCents: 25_000,
    priceYearlyCents: 250_000,
    limits: {
      AI_CALLS_PER_MONTH: 2_000,
      MESSAGES_PER_MONTH: 2_500,
      AI_COST_USD_PER_MONTH: 15,
      USERS: 3,
      WHATSAPP_NUMBERS: 1,
      STORAGE_MB: 1_024,
      AUTOMATIONS: 3,
    },
    features: ['AI_AGENT', 'CRM', 'CALENDAR', 'AUTOMATIONS'],
    highlight: false,
    sortOrder: 10,
  },
  {
    key: 'PRO',
    name: 'Pro',
    tagline: 'Para empresas que já usam automação de forma intensa.',
    description:
      'Limites bem maiores, relatórios avançados, documentos na base de conhecimento e Google Agenda.',
    priceMonthlyCents: 45_000,
    priceYearlyCents: 450_000,
    limits: {
      AI_CALLS_PER_MONTH: 7_000,
      MESSAGES_PER_MONTH: 8_000,
      AI_COST_USD_PER_MONTH: 40,
      USERS: 10,
      WHATSAPP_NUMBERS: 2,
      STORAGE_MB: 5_120,
      AUTOMATIONS: 20,
    },
    features: [
      'AI_AGENT',
      'CRM',
      'CALENDAR',
      'AUTOMATIONS',
      'ADVANCED_ANALYTICS',
      'KNOWLEDGE_UPLOADS',
      'CALENDAR_SYNC',
    ],
    highlight: true,
    sortOrder: 20,
  },
  {
    key: 'BUSINESS',
    name: 'Business',
    tagline: 'Para operações com alto volume de atendimento.',
    description:
      'Os maiores limites, API, webhooks, automações sem limite, suporte prioritário e sem a marca WebZen.',
    priceMonthlyCents: 75_000,
    priceYearlyCents: 750_000,
    limits: {
      AI_CALLS_PER_MONTH: 20_000,
      MESSAGES_PER_MONTH: 25_000,
      AI_COST_USD_PER_MONTH: 90,
      USERS: 30,
      WHATSAPP_NUMBERS: 5,
      STORAGE_MB: 20_480,
      AUTOMATIONS: null,
    },
    features: [
      'AI_AGENT',
      'CRM',
      'CALENDAR',
      'AUTOMATIONS',
      'ADVANCED_ANALYTICS',
      'KNOWLEDGE_UPLOADS',
      'CALENDAR_SYNC',
      'API_ACCESS',
      'WEBHOOKS',
      'PRIORITY_SUPPORT',
      'REMOVE_BRANDING',
    ],
    highlight: false,
    sortOrder: 30,
  },
];

export const FEATURE_LABELS: Record<FeatureFlagKey, string> = {
  AI_AGENT: 'Atendente com IA no WhatsApp',
  CRM: 'CRM com funil de vendas',
  CALENDAR: 'Agenda com agendamento pela IA',
  AUTOMATIONS: 'Automações',
  ADVANCED_ANALYTICS: 'Relatórios avançados',
  KNOWLEDGE_UPLOADS: 'Documentos na base de conhecimento',
  CALENDAR_SYNC: 'Sincronização com Google Agenda',
  API_ACCESS: 'API e chaves de acesso',
  WEBHOOKS: 'Webhooks de eventos',
  PRIORITY_SUPPORT: 'Suporte prioritário',
  REMOVE_BRANDING: 'Sem a marca "Powered by WebZen"',
  WHITE_LABEL: 'Marca própria (white label)',
};

export const USAGE_METRIC_LABELS: Record<UsageMetric, string> = {
  AI_CALLS_PER_MONTH: 'Chamadas da IA no mês',
  MESSAGES_PER_MONTH: 'Mensagens enviadas no mês',
  AI_COST_USD_PER_MONTH: 'Consumo da IA no mês (US$)',
  USERS: 'Usuários',
  WHATSAPP_NUMBERS: 'Números de WhatsApp',
  STORAGE_MB: 'Armazenamento (MB)',
  AUTOMATIONS: 'Automações ativas',
};

/** Limiares de aviso de consumo, em % do limite. O último (100) é o bloqueio. */
export const USAGE_ALERT_THRESHOLDS = [70, 90, 100] as const;

/** Maior limiar já atingido (0 = nenhum). */
export function usageThresholdReached(current: number, limit: number | null): number {
  if (limit === null) return 0;
  if (limit <= 0) return 100;
  const percent = (current / limit) * 100;
  return [...USAGE_ALERT_THRESHOLDS].reverse().find((threshold) => percent >= threshold) ?? 0;
}

/** Economia do plano anual frente a 12 mensalidades (centavos e % arredondado). */
export function yearlySavings(
  priceMonthlyCents: number,
  priceYearlyCents: number | null,
): { cents: number; percent: number } | null {
  if (priceYearlyCents === null || priceMonthlyCents <= 0) return null;
  const cents = priceMonthlyCents * 12 - priceYearlyCents;
  if (cents <= 0) return null;
  return { cents, percent: Math.round((cents / (priceMonthlyCents * 12)) * 100) };
}

export function planPriceCents(
  plan: { priceMonthlyCents: number; priceYearlyCents: number | null },
  interval: BillingInterval,
): number | null {
  return interval === 'MONTHLY' ? plan.priceMonthlyCents : plan.priceYearlyCents;
}

/**
 * Situação de cobrança que libera o uso do plano. `PAST_DUE` mantém o acesso enquanto a
 * Stripe tenta cobrar de novo (aviso no painel); os demais estados inativos restringem.
 */
const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
]);

export function subscriptionGrantsAccess(
  subscription: { status: SubscriptionStatus; trialEndsAt?: Date | null } | null,
  now: Date = new Date(),
): boolean {
  if (!subscription || !ENTITLED_STATUSES.has(subscription.status)) return false;
  if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
    return subscription.trialEndsAt.getTime() > now.getTime();
  }
  return true;
}

/** Formata centavos em BRL para mensagens geradas no servidor (e-mails, notificações). */
export function formatCentsBRL(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}
