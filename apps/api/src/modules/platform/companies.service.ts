import { randomBytes } from 'node:crypto';
import {
  createTenantClient,
  decimalToNumber,
  hashPassword,
  systemDb,
  type BillingInterval,
  type CompanyStatus,
  type FeatureFlagKey,
  type SubscriptionStatus,
  type Prisma,
  type UsageMetric,
} from '@botsaas/database';
import { NotFoundError, type BusinessTemplateKey } from '@botsaas/shared';
import type { AppContainer } from '../../container';
import type { Actor } from '../../context';
import { auditPlatform } from '../../lib/audit';
import { systemScope } from '../../lib/scope';
import { applyBusinessTemplate } from '../company/templates/service';
import { getUsageStatus } from '../usage/limits';

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || 'empresa';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const exists = await systemDb.company.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}

export interface CreateCompanyInput {
  name: string;
  templateKey: BusinessTemplateKey;
  timezone: string;
  phone?: string | null;
  email?: string | null;
  planKey?: string | null;
  owner: { email: string; name: string; password?: string | null };
  /** Cadastro público: o dono confirma o e-mail depois. Padrão: já confirmado (criado pela plataforma). */
  ownerEmailVerified?: boolean;
  /** Padrão ACTIVE (gerida pela plataforma). O cadastro público começa em INCOMPLETE. */
  subscriptionStatus?: SubscriptionStatus;
  billingInterval?: BillingInterval;
  signupReferralCode?: string | null;
}

/**
 * Provisiona uma empresa completa: registro, dono, assinatura e template aplicado.
 * Nenhuma alteração de código é necessária para cadastrar um novo cliente.
 */
export async function createCompany(
  container: AppContainer,
  actor: Actor,
  input: CreateCompanyInput,
) {
  const ownerEmail = input.owner.email.trim().toLowerCase();
  let generatedPassword: string | null = null;

  const plan = input.planKey
    ? await systemDb.plan.findUnique({ where: { key: input.planKey } })
    : await systemDb.plan.findFirst({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
      });
  if (input.planKey && !plan) throw new NotFoundError('Plano não encontrado.');

  const company = await systemDb.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        name: input.name.trim(),
        slug: await uniqueSlug(input.name),
        templateKey: input.templateKey,
        timezone: input.timezone,
        phone: input.phone ?? null,
        email: input.email ?? null,
        status: 'ONBOARDING',
        signupReferralCode: input.signupReferralCode ?? null,
      },
    });

    let owner = await tx.user.findUnique({ where: { email: ownerEmail } });
    if (!owner) {
      const password =
        input.owner.password ?? (generatedPassword = randomBytes(9).toString('base64url'));
      owner = await tx.user.create({
        data: {
          email: ownerEmail,
          name: input.owner.name.trim(),
          passwordHash: await hashPassword(password),
          mustChangePassword: input.owner.password ? false : true,
          emailVerifiedAt: input.ownerEmailVerified === false ? null : new Date(),
        },
      });
    }
    await tx.companyMember.create({
      data: {
        companyId: created.id,
        userId: owner.id,
        role: 'COMPANY_OWNER',
        invitedById: actor.userId ?? null,
      },
    });
    if (plan) {
      await tx.subscription.create({
        data: {
          companyId: created.id,
          planId: plan.id,
          status: input.subscriptionStatus ?? 'ACTIVE',
          interval: input.billingInterval ?? 'MONTHLY',
          currentPeriodStart: new Date(),
        },
      });
    }
    return created;
  });

  await applyBusinessTemplate(systemScope(container, company.id, actor), input.templateKey, {
    includeAgentDefaults: true,
  });
  await auditPlatform(actor, {
    companyId: company.id,
    action: 'company.created',
    resourceType: 'Company',
    resourceId: company.id,
    metadata: { name: company.name, template: input.templateKey, ownerEmail },
  });

  return { company, ownerTemporaryPassword: generatedPassword };
}

export async function listCompanies(query: {
  search?: string;
  status?: CompanyStatus;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.CompanyWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [total, companies] = await Promise.all([
    systemDb.company.count({ where }),
    systemDb.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        subscription: { include: { plan: { select: { key: true, name: true } } } },
        whatsappAccounts: { select: { status: true, displayPhoneNumber: true } },
        aiConfiguration: { select: { enabled: true } },
        _count: { select: { members: true } },
      },
    }),
  ]);
  const ids = companies.map((company) => company.id);
  const [conversationCounts, costs, errors] = await Promise.all([
    systemDb.conversation.groupBy({
      by: ['companyId'],
      where: { companyId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    systemDb.usageRecord.groupBy({
      by: ['companyId'],
      where: { companyId: { in: ids }, kind: 'AI_CALL', occurredAt: { gte: since } },
      _sum: { costUsd: true },
    }),
    systemDb.errorLog.groupBy({
      by: ['companyId'],
      where: {
        companyId: { in: ids },
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
      _count: { _all: true },
    }),
  ]);
  const items = companies.map((company) => ({
    id: company.id,
    name: company.name,
    slug: company.slug,
    status: company.status,
    templateKey: company.templateKey,
    plan: company.subscription?.plan ?? null,
    aiEnabled: company.aiConfiguration?.enabled ?? false,
    whatsapp:
      company.whatsappAccounts.length === 0
        ? 'NOT_CONFIGURED'
        : company.whatsappAccounts.some((account) => account.status === 'CONNECTED')
          ? 'CONNECTED'
          : (company.whatsappAccounts[0]?.status ?? 'PENDING'),
    members: company._count.members,
    conversations30d:
      conversationCounts.find((row) => row.companyId === company.id)?._count._all ?? 0,
    aiCost30dUsd:
      decimalToNumber(costs.find((row) => row.companyId === company.id)?._sum.costUsd ?? null) ?? 0,
    errors24h: errors.find((row) => row.companyId === company.id)?._count._all ?? 0,
    createdAt: company.createdAt,
  }));
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getCompanyDetail(container: AppContainer, companyId: string) {
  const company = await systemDb.company.findUnique({
    where: { id: companyId },
    include: {
      subscription: { include: { plan: true } },
      whatsappAccounts: {
        select: {
          id: true,
          phoneNumberId: true,
          displayPhoneNumber: true,
          verifiedName: true,
          status: true,
          lastError: true,
          lastWebhookAt: true,
          qualityRating: true,
        },
      },
      aiConfiguration: {
        select: {
          enabled: true,
          model: true,
          messageBufferSeconds: true,
          dailyBudgetUsd: true,
          monthlyBudgetUsd: true,
        },
      },
      featureFlags: true,
      members: { include: { user: { select: { id: true, email: true, name: true } } } },
    },
  });
  if (!company) throw new NotFoundError('Empresa não encontrada.');
  const scope = systemScope(container, companyId);
  const [usage, recentErrors, conversationsTotal] = await Promise.all([
    getUsageStatus(scope),
    systemDb.errorLog.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    systemDb.conversation.count({ where: { companyId } }),
  ]);
  return {
    ...company,
    aiConfiguration: company.aiConfiguration
      ? {
          ...company.aiConfiguration,
          dailyBudgetUsd: decimalToNumber(company.aiConfiguration.dailyBudgetUsd),
          monthlyBudgetUsd: decimalToNumber(company.aiConfiguration.monthlyBudgetUsd),
        }
      : null,
    members: company.members.map((member) => ({
      id: member.id,
      role: member.role,
      isActive: member.isActive,
      user: member.user,
    })),
    usage,
    recentErrors,
    conversationsTotal,
  };
}

export async function updateCompany(
  actor: Actor,
  companyId: string,
  data: { name?: string; timezone?: string; phone?: string | null; email?: string | null },
) {
  const company = await systemDb.company.update({ where: { id: companyId }, data });
  await auditPlatform(actor, {
    companyId,
    action: 'company.updated',
    resourceType: 'Company',
    resourceId: companyId,
    metadata: { fields: Object.keys(data) },
  });
  return company;
}

export async function setCompanyStatus(
  actor: Actor,
  companyId: string,
  status: CompanyStatus,
  reason?: string | null,
) {
  const company = await systemDb.company.update({
    where: { id: companyId },
    data: {
      status,
      suspendedReason: status === 'SUSPENDED' ? (reason ?? null) : null,
      ...(status === 'ACTIVE' ? { activatedAt: new Date() } : {}),
    },
  });
  await auditPlatform(actor, {
    companyId,
    action: `company.status.${status.toLowerCase()}`,
    resourceType: 'Company',
    resourceId: companyId,
    metadata: { reason },
  });
  return company;
}

export async function setAgentSuspended(actor: Actor, companyId: string, suspended: boolean) {
  const db = createTenantClient(companyId);
  const config = await db.aIConfiguration.findFirst();
  if (!config) throw new NotFoundError('Configuração da IA não encontrada.');
  await db.aIConfiguration.update({ where: { id: config.id }, data: { enabled: !suspended } });
  await auditPlatform(actor, {
    companyId,
    action: suspended ? 'ai.suspended_by_platform' : 'ai.resumed_by_platform',
    resourceType: 'AIConfiguration',
    resourceId: config.id,
  });
}

export async function setUsageLimits(
  actor: Actor,
  companyId: string,
  limits: { metric: UsageMetric; limitValue: number | null; warningPercent?: number }[],
) {
  const db = createTenantClient(companyId);
  for (const limit of limits) {
    await db.usageLimit.upsert({
      where: { companyId_metric: { companyId, metric: limit.metric } },
      create: {
        companyId,
        metric: limit.metric,
        limitValue: limit.limitValue,
        warningPercent: limit.warningPercent ?? 80,
      },
      update: { limitValue: limit.limitValue, warningPercent: limit.warningPercent ?? 80 },
    });
  }
  await auditPlatform(actor, {
    companyId,
    action: 'limits.updated',
    resourceType: 'UsageLimit',
    metadata: { limits },
  });
}

export async function removeUsageLimit(actor: Actor, companyId: string, metric: UsageMetric) {
  await createTenantClient(companyId).usageLimit.deleteMany({ where: { metric } });
  await auditPlatform(actor, {
    companyId,
    action: 'limits.override_removed',
    resourceType: 'UsageLimit',
    metadata: { metric },
  });
}

export async function setFeatureFlag(
  actor: Actor,
  companyId: string,
  flag: FeatureFlagKey,
  enabled: boolean | null,
) {
  const db = createTenantClient(companyId);
  if (enabled === null) {
    await db.companyFeatureFlag.deleteMany({ where: { flag } });
  } else {
    await db.companyFeatureFlag.upsert({
      where: { companyId_flag: { companyId, flag } },
      create: { companyId, flag, enabled },
      update: { enabled },
    });
  }
  await auditPlatform(actor, {
    companyId,
    action: 'feature_flag.updated',
    resourceType: 'CompanyFeatureFlag',
    metadata: { flag, enabled },
  });
}

export async function changePlan(actor: Actor, companyId: string, planKey: string) {
  const plan = await systemDb.plan.findUnique({ where: { key: planKey } });
  if (!plan) throw new NotFoundError('Plano não encontrado.');
  const db = createTenantClient(companyId);
  const existing = await db.subscription.findFirst();
  if (existing) {
    await db.subscription.update({ where: { id: existing.id }, data: { planId: plan.id } });
  } else {
    await db.subscription.create({
      data: { companyId, planId: plan.id, status: 'ACTIVE', currentPeriodStart: new Date() },
    });
  }
  await auditPlatform(actor, {
    companyId,
    action: 'subscription.plan_changed',
    resourceType: 'Subscription',
    metadata: { planKey },
  });
}

export async function startSupportMode(
  actor: Actor,
  sessionId: string,
  companyId: string,
  reason: string,
  ip?: string,
) {
  const company = await systemDb.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) throw new NotFoundError('Empresa não encontrada.');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await systemDb.session.update({
    where: { id: sessionId },
    data: { supportCompanyId: companyId, supportExpiresAt: expiresAt },
  });
  await auditPlatform(actor, {
    companyId,
    action: 'support_mode.started',
    resourceType: 'Company',
    resourceId: companyId,
    metadata: { reason, expiresAt },
    ip,
  });
  return { expiresAt };
}

export async function stopSupportMode(actor: Actor, sessionId: string, companyId: string | null) {
  await systemDb.session.update({
    where: { id: sessionId },
    data: { supportCompanyId: null, supportExpiresAt: null },
  });
  if (companyId) {
    await auditPlatform(actor, {
      companyId,
      action: 'support_mode.ended',
      resourceType: 'Company',
      resourceId: companyId,
    });
  }
}

export async function assertCompanyExists(companyId: string) {
  const company = await systemDb.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) throw new NotFoundError('Empresa não encontrada.');
}
