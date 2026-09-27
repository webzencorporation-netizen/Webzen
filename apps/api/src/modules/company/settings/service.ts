import type { Prisma } from '@botsaas/database';
import { getBusinessTemplate } from '@botsaas/ai';
import { ValidationError, weeklyScheduleSchema, type WeeklySchedule } from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { getOwnCompany, updateOwnCompany } from '../../../lib/company-record';

export const ONBOARDING_STEPS = [
  { key: 'company', title: 'Dados da empresa' },
  { key: 'hours', title: 'Horários' },
  { key: 'catalog', title: 'Serviços e produtos' },
  { key: 'faq', title: 'Perguntas frequentes' },
  { key: 'ai', title: 'Personalidade da IA' },
  { key: 'whatsapp', title: 'WhatsApp' },
  { key: 'integrations', title: 'Agenda e integrações' },
  { key: 'test', title: 'Teste' },
  { key: 'activation', title: 'Ativação' },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];

interface OnboardingState {
  completed: string[];
  skipped: string[];
  current?: string;
}

function readState(value: Prisma.JsonValue | null): OnboardingState {
  const state = (value ?? {}) as Partial<OnboardingState>;
  return { completed: state.completed ?? [], skipped: state.skipped ?? [], current: state.current };
}

export interface CompanyAddress {
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  mapsUrl?: string;
}

export function formatAddress(address: CompanyAddress | null | undefined): string | null {
  if (!address) return null;
  const line1 = [address.street, address.number].filter(Boolean).join(', ');
  const parts = [
    line1,
    address.complement,
    address.district,
    [address.city, address.state].filter(Boolean).join('/'),
    address.zip,
  ];
  const text = parts.filter((part) => part && part.trim().length > 0).join(' - ');
  return text || null;
}

export async function getCompanyProfile(scope: CompanyScope) {
  const company = await getOwnCompany(scope);
  const holidays = await scope.db.holiday.findMany({ orderBy: { date: 'asc' } });
  const template = getBusinessTemplate(company.templateKey);
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    status: company.status,
    templateKey: company.templateKey,
    templateName: template.name,
    segment: company.segment,
    legalName: company.legalName,
    document: company.document,
    phone: company.phone,
    email: company.email,
    website: company.website,
    description: company.description,
    address: (company.address ?? null) as CompanyAddress | null,
    timezone: company.timezone,
    locale: company.locale,
    currency: company.currency,
    businessHours: (company.businessHours ?? []) as WeeklySchedule,
    holidays,
    messageRetentionDays: company.messageRetentionDays,
    activatedAt: company.activatedAt,
  };
}

export interface CompanyProfileInput {
  name?: string;
  segment?: string | null;
  legalName?: string | null;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  description?: string | null;
  address?: CompanyAddress | null;
  timezone?: string;
  messageRetentionDays?: number | null;
}

export async function updateCompanyProfile(scope: CompanyScope, input: CompanyProfileInput) {
  const { address, ...rest } = input;
  await updateOwnCompany(scope, {
    ...rest,
    ...(address !== undefined
      ? { address: (address ?? undefined) as Prisma.InputJsonValue | undefined }
      : {}),
  });
  await audit(scope, {
    action: 'company.profile_updated',
    resourceType: 'Company',
    resourceId: scope.companyId,
    metadata: { fields: Object.keys(input) },
  });
  return getCompanyProfile(scope);
}

export async function updateBusinessHours(scope: CompanyScope, schedule: WeeklySchedule) {
  const parsed = weeklyScheduleSchema.safeParse(schedule);
  if (!parsed.success)
    throw new ValidationError('Horário inválido.', { details: parsed.error.issues });
  await updateOwnCompany(scope, { businessHours: parsed.data as Prisma.InputJsonValue });
  return getCompanyProfile(scope);
}

export async function upsertHoliday(
  scope: CompanyScope,
  input: {
    date: string;
    name: string;
    closed: boolean;
    open?: string | null;
    close?: string | null;
  },
) {
  if (!input.closed && (!input.open || !input.close || input.open >= input.close)) {
    throw new ValidationError('Informe abertura e fechamento válidos para o horário especial.');
  }
  return scope.db.holiday.upsert({
    where: { companyId_date: { companyId: scope.companyId, date: input.date } },
    create: { companyId: scope.companyId, ...input },
    update: input,
  });
}

export async function deleteHoliday(scope: CompanyScope, id: string) {
  await scope.db.holiday.deleteMany({ where: { id } });
}

/** Etapas do onboarding: concluída se marcada pelo usuário OU se os dados já existem. */
export async function getOnboarding(scope: CompanyScope) {
  const company = await getOwnCompany(scope);
  const state = readState(company.onboardingState);
  const [services, products, faqs, aiConfig, whatsapp, testRuns, calendar] = await Promise.all([
    scope.db.service.count(),
    scope.db.product.count(),
    scope.db.knowledgeEntry.count({ where: { type: 'FAQ' } }),
    scope.db.aIConfiguration.findFirst({ select: { version: true, personality: true } }),
    scope.db.whatsAppAccount.count({ where: { status: 'CONNECTED' } }),
    scope.db.agentRun.count({ where: { trigger: 'TEST_CHAT', status: 'SUCCEEDED' } }),
    scope.db.integration.count({ where: { provider: 'GOOGLE_CALENDAR', status: 'CONNECTED' } }),
  ]);
  const hours = Array.isArray(company.businessHours) && company.businessHours.length > 0;
  const computed: Record<OnboardingStepKey, boolean> = {
    company: Boolean(company.name && company.phone && company.description),
    hours,
    catalog: services + products > 0,
    faq: faqs > 0,
    ai: Boolean(aiConfig && (aiConfig.version > 1 || aiConfig.personality)),
    whatsapp: whatsapp > 0,
    integrations: calendar > 0,
    test: testRuns > 0,
    activation: company.status === 'ACTIVE',
  };
  const steps = ONBOARDING_STEPS.map((step) => ({
    ...step,
    done: computed[step.key] || state.completed.includes(step.key),
    skipped: state.skipped.includes(step.key),
  }));
  const doneCount = steps.filter((step) => step.done || step.skipped).length;
  return {
    steps,
    current:
      state.current ?? steps.find((step) => !step.done && !step.skipped)?.key ?? 'activation',
    progress: Math.round((doneCount / steps.length) * 100),
    finished: company.onboardingDoneAt !== null,
  };
}

export async function saveOnboardingProgress(
  scope: CompanyScope,
  input: {
    step: OnboardingStepKey;
    action: 'complete' | 'skip' | 'reopen';
    current?: OnboardingStepKey;
  },
) {
  const company = await getOwnCompany(scope);
  const state = readState(company.onboardingState);
  const completed = new Set(state.completed);
  const skipped = new Set(state.skipped);
  if (input.action === 'complete') {
    completed.add(input.step);
    skipped.delete(input.step);
  } else if (input.action === 'skip') {
    skipped.add(input.step);
  } else {
    completed.delete(input.step);
    skipped.delete(input.step);
  }
  await updateOwnCompany(scope, {
    onboardingState: {
      completed: [...completed],
      skipped: [...skipped],
      current: input.current ?? input.step,
    } as Prisma.InputJsonValue,
  });
  return getOnboarding(scope);
}

/** Ativa a empresa (e opcionalmente a IA). Exige dados mínimos para não ativar um agente "vazio". */
export async function activateCompany(scope: CompanyScope, input: { enableAi: boolean }) {
  const onboarding = await getOnboarding(scope);
  const required: OnboardingStepKey[] = ['company', 'ai'];
  const missing = onboarding.steps.filter((step) => required.includes(step.key) && !step.done);
  if (missing.length > 0) {
    throw new ValidationError(`Complete antes: ${missing.map((step) => step.title).join(', ')}.`);
  }
  const company = await getOwnCompany(scope);
  await updateOwnCompany(scope, {
    status: company.status === 'ONBOARDING' ? 'ACTIVE' : company.status,
    activatedAt: company.activatedAt ?? new Date(),
    onboardingDoneAt: new Date(),
  });
  if (input.enableAi) {
    const config = await scope.db.aIConfiguration.findFirst();
    if (config)
      await scope.db.aIConfiguration.update({ where: { id: config.id }, data: { enabled: true } });
  }
  await audit(scope, {
    action: 'company.activated',
    resourceType: 'Company',
    resourceId: scope.companyId,
    metadata: { enableAi: input.enableAi },
  });
  return getOnboarding(scope);
}
