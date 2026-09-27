import { DEFAULT_MODEL_PRICING } from '@botsaas/ai';
import { systemDb, type Prisma } from '@botsaas/database';

/** Planos iniciais (sem cobrança real — estrutura para a fase SaaS). Valores ajustáveis no painel. */
export const DEFAULT_PLANS: Prisma.PlanCreateInput[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    description: 'Um número de WhatsApp, atendente virtual e CRM básico.',
    priceCents: 29_900,
    limits: {
      AI_CALLS_PER_MONTH: 2000,
      MESSAGES_PER_MONTH: 5000,
      AI_COST_USD_PER_MONTH: 40,
      USERS: 3,
      WHATSAPP_NUMBERS: 1,
      STORAGE_MB: 1024,
    },
    features: ['AI_AGENT', 'CRM'],
  },
  {
    key: 'PRO',
    name: 'Pro',
    description: 'Agenda, automações e base de conhecimento com documentos.',
    priceCents: 59_900,
    limits: {
      AI_CALLS_PER_MONTH: 8000,
      MESSAGES_PER_MONTH: 20000,
      AI_COST_USD_PER_MONTH: 150,
      USERS: 10,
      WHATSAPP_NUMBERS: 2,
      STORAGE_MB: 5120,
    },
    features: ['AI_AGENT', 'CRM', 'CALENDAR', 'AUTOMATIONS', 'KNOWLEDGE_UPLOADS'],
  },
  {
    key: 'BUSINESS',
    name: 'Business',
    description: 'Volume alto, relatórios avançados e múltiplos números.',
    priceCents: 129_900,
    limits: {
      AI_CALLS_PER_MONTH: 30000,
      MESSAGES_PER_MONTH: 80000,
      AI_COST_USD_PER_MONTH: 600,
      USERS: 50,
      WHATSAPP_NUMBERS: 5,
      STORAGE_MB: 20480,
    },
    features: [
      'AI_AGENT',
      'CRM',
      'CALENDAR',
      'AUTOMATIONS',
      'ADVANCED_ANALYTICS',
      'KNOWLEDGE_UPLOADS',
    ],
  },
];

/** Dados de referência idempotentes (planos e preços de modelos). Seguro em qualquer ambiente. */
export async function seedReferenceData(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    await systemDb.plan.upsert({ where: { key: plan.key }, create: plan, update: {} });
  }
  for (const [model, price] of Object.entries(DEFAULT_MODEL_PRICING)) {
    await systemDb.modelPricing.upsert({
      where: { model },
      create: { model, ...price },
      update: {},
    });
  }
}
