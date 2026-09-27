import { listBusinessTemplates } from '@botsaas/ai';
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  systemDb,
  decimalToNumber,
  type Prisma,
} from '@botsaas/database';
import {
  BUSINESS_TEMPLATE_KEYS,
  COMPANY_STATUSES,
  ConflictError,
  FEATURE_FLAGS,
  NotFoundError,
  PLATFORM_ROLES,
} from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Actor } from '../../context';
import { auditPlatform } from '../../lib/audit';
import { idParamSchema, paginationQuerySchema } from '../../lib/http';
import { systemScope } from '../../lib/scope';
import { periodStart } from '../../lib/time';
import { platform, requireAuthContext } from '../../plugins/guards';
import { applyBusinessTemplate } from '../company/templates/service';
import { USAGE_METRICS } from '../usage/limits';
import { costByCompany, summarizeAiUsageByPeriod } from '../usage/report';
import {
  assertCompanyExists,
  changePlan,
  createCompany,
  getCompanyDetail,
  listCompanies,
  removeUsageLimit,
  setAgentSuspended,
  setCompanyStatus,
  setFeatureFlag,
  setUsageLimits,
  startSupportMode,
  stopSupportMode,
  updateCompany,
} from './companies.service';
import { getPlatformHealth } from './health.service';

const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido');

const metricSchema = z
  .enum(USAGE_METRICS as [string, ...string[]])
  .transform((value) => value as (typeof USAGE_METRICS)[number]);

const planLimitsSchema = z.record(z.string(), z.number().nonnegative().nullable());

function actorOf(request: Parameters<typeof requireAuthContext>[0]): Actor {
  const auth = requireAuthContext(request);
  return { type: 'PLATFORM_ADMIN', userId: auth.user.id, label: auth.user.name };
}

/**
 * Área administrativa da PLATAFORMA. Separada do painel das empresas:
 * prefixo próprio (/api/platform), guards de papel de plataforma e client sem escopo explícito.
 */
export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  const { container } = app;

  // ── Empresas ──────────────────────────────────────────────────────────────
  app.get(
    '/companies',
    {
      preValidation: platform('platform:companies:read'),
      schema: {
        querystring: paginationQuerySchema.extend({
          search: z.string().max(100).optional(),
          status: z.enum(COMPANY_STATUSES).optional(),
        }),
      },
    },
    async (request) => listCompanies(request.query),
  );

  app.post(
    '/companies',
    {
      preValidation: platform('platform:companies:write'),
      schema: {
        body: z.object({
          name: z.string().min(2).max(120),
          templateKey: z.enum(BUSINESS_TEMPLATE_KEYS),
          timezone: timezoneSchema.default('America/Sao_Paulo'),
          phone: z.string().max(30).nullish(),
          email: z.email().nullish(),
          planKey: z.string().max(50).nullish(),
          owner: z.object({
            email: z.email(),
            name: z.string().min(2).max(120),
            password: z.string().min(PASSWORD_MIN_LENGTH).max(200).nullish(),
          }),
        }),
      },
    },
    async (request, reply) => {
      const result = await createCompany(container, actorOf(request), request.body);
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/companies/:id',
    { preValidation: platform('platform:companies:read'), schema: { params: idParamSchema } },
    async (request) => getCompanyDetail(container, request.params.id),
  );

  app.patch(
    '/companies/:id',
    {
      preValidation: platform('platform:companies:write'),
      schema: {
        params: idParamSchema,
        body: z.object({
          name: z.string().min(2).max(120).optional(),
          timezone: timezoneSchema.optional(),
          phone: z.string().max(30).nullish(),
          email: z.email().nullish(),
        }),
      },
    },
    async (request) => updateCompany(actorOf(request), request.params.id, request.body),
  );

  app.post(
    '/companies/:id/status',
    {
      preValidation: platform('platform:companies:write'),
      schema: {
        params: idParamSchema,
        body: z.object({ status: z.enum(COMPANY_STATUSES), reason: z.string().max(300).nullish() }),
      },
    },
    async (request) =>
      setCompanyStatus(
        actorOf(request),
        request.params.id,
        request.body.status,
        request.body.reason,
      ),
  );

  app.post(
    '/companies/:id/agent',
    {
      preValidation: platform('platform:companies:write'),
      schema: { params: idParamSchema, body: z.object({ suspended: z.boolean() }) },
    },
    async (request) => {
      await setAgentSuspended(actorOf(request), request.params.id, request.body.suspended);
      return { ok: true };
    },
  );

  app.put(
    '/companies/:id/limits',
    {
      preValidation: platform('platform:companies:write'),
      schema: {
        params: idParamSchema,
        body: z.object({
          limits: z.array(
            z.object({
              metric: metricSchema,
              limitValue: z.number().nonnegative().nullable(),
              warningPercent: z.number().int().min(1).max(100).optional(),
            }),
          ),
        }),
      },
    },
    async (request) => {
      await assertCompanyExists(request.params.id);
      await setUsageLimits(actorOf(request), request.params.id, request.body.limits);
      return { ok: true };
    },
  );

  app.delete(
    '/companies/:id/limits/:metric',
    {
      preValidation: platform('platform:companies:write'),
      schema: { params: idParamSchema.extend({ metric: metricSchema }) },
    },
    async (request) => {
      await removeUsageLimit(actorOf(request), request.params.id, request.params.metric);
      return { ok: true };
    },
  );

  app.put(
    '/companies/:id/feature-flags',
    {
      preValidation: platform('platform:companies:write'),
      schema: {
        params: idParamSchema,
        body: z.object({ flag: z.enum(FEATURE_FLAGS), enabled: z.boolean().nullable() }),
      },
    },
    async (request) => {
      await assertCompanyExists(request.params.id);
      await setFeatureFlag(
        actorOf(request),
        request.params.id,
        request.body.flag,
        request.body.enabled,
      );
      return { ok: true };
    },
  );

  app.put(
    '/companies/:id/plan',
    {
      preValidation: platform('platform:plans:write'),
      schema: { params: idParamSchema, body: z.object({ planKey: z.string().min(1).max(50) }) },
    },
    async (request) => {
      await assertCompanyExists(request.params.id);
      await changePlan(actorOf(request), request.params.id, request.body.planKey);
      return { ok: true };
    },
  );

  app.post(
    '/companies/:id/template',
    {
      preValidation: platform('platform:companies:write'),
      schema: {
        params: idParamSchema,
        body: z.object({
          templateKey: z.enum(BUSINESS_TEMPLATE_KEYS),
          includeAgentDefaults: z.boolean().default(false),
        }),
      },
    },
    async (request) => {
      await assertCompanyExists(request.params.id);
      await applyBusinessTemplate(
        systemScope(container, request.params.id, actorOf(request)),
        request.body.templateKey,
        {
          includeAgentDefaults: request.body.includeAgentDefaults,
        },
      );
      return { ok: true };
    },
  );

  // ── Modo suporte ──────────────────────────────────────────────────────────
  app.post(
    '/companies/:id/support',
    {
      preValidation: platform('platform:support_mode'),
      schema: { params: idParamSchema, body: z.object({ reason: z.string().min(5).max(300) }) },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      return startSupportMode(
        actorOf(request),
        auth.session.id,
        request.params.id,
        request.body.reason,
        request.ip,
      );
    },
  );

  app.delete('/support', { preValidation: platform('platform:support_mode') }, async (request) => {
    const auth = requireAuthContext(request);
    await stopSupportMode(actorOf(request), auth.session.id, auth.session.supportCompanyId);
    return { ok: true };
  });

  // ── Planos ────────────────────────────────────────────────────────────────
  const planBody = z.object({
    key: z.string().regex(/^[A-Z0-9_]{2,30}$/),
    name: z.string().min(2).max(60),
    description: z.string().max(300).nullish(),
    priceCents: z.number().int().nonnegative(),
    isActive: z.boolean().default(true),
    limits: planLimitsSchema,
    features: z.array(z.enum(FEATURE_FLAGS)),
  });

  app.get('/plans', { preValidation: platform('platform:companies:read') }, async () => {
    const plans = await systemDb.plan.findMany({
      orderBy: { priceCents: 'asc' },
      include: { _count: { select: { subscriptions: true } } },
    });
    return plans.map(({ _count, ...plan }) => ({ ...plan, subscriptions: _count.subscriptions }));
  });

  app.post(
    '/plans',
    { preValidation: platform('platform:plans:write'), schema: { body: planBody } },
    async (request, reply) => {
      const exists = await systemDb.plan.findUnique({ where: { key: request.body.key } });
      if (exists) throw new ConflictError('Já existe um plano com esta chave.');
      const plan = await systemDb.plan.create({
        data: { ...request.body, limits: request.body.limits as Prisma.InputJsonValue },
      });
      await auditPlatform(actorOf(request), {
        action: 'plan.created',
        resourceType: 'Plan',
        resourceId: plan.id,
        metadata: { key: plan.key },
      });
      return reply.status(201).send(plan);
    },
  );

  app.patch(
    '/plans/:id',
    {
      preValidation: platform('platform:plans:write'),
      schema: { params: idParamSchema, body: planBody.omit({ key: true }).partial() },
    },
    async (request) => {
      const { limits, ...rest } = request.body;
      const plan = await systemDb.plan.update({
        where: { id: request.params.id },
        data: { ...rest, ...(limits ? { limits: limits as Prisma.InputJsonValue } : {}) },
      });
      await auditPlatform(actorOf(request), {
        action: 'plan.updated',
        resourceType: 'Plan',
        resourceId: plan.id,
        metadata: { fields: Object.keys(request.body) },
      });
      return plan;
    },
  );

  // ── Preços de modelos ────────────────────────────────────────────────────
  app.get('/pricing', { preValidation: platform('platform:usage:read') }, async () => {
    const rows = await systemDb.modelPricing.findMany({ orderBy: { model: 'asc' } });
    return rows.map((row) => ({
      ...row,
      inputUsdPerMTok: decimalToNumber(row.inputUsdPerMTok),
      outputUsdPerMTok: decimalToNumber(row.outputUsdPerMTok),
      cacheWriteUsdPerMTok: decimalToNumber(row.cacheWriteUsdPerMTok),
      cacheReadUsdPerMTok: decimalToNumber(row.cacheReadUsdPerMTok),
    }));
  });

  app.put(
    '/pricing/:model',
    {
      preValidation: platform('platform:pricing:write'),
      schema: {
        params: z.object({ model: z.string().regex(/^[a-z0-9.-]{3,80}$/) }),
        body: z.object({
          displayName: z.string().max(80).nullish(),
          inputUsdPerMTok: z.number().nonnegative(),
          outputUsdPerMTok: z.number().nonnegative(),
          cacheWriteUsdPerMTok: z.number().nonnegative(),
          cacheReadUsdPerMTok: z.number().nonnegative(),
          isActive: z.boolean().default(true),
        }),
      },
    },
    async (request) => {
      const row = await systemDb.modelPricing.upsert({
        where: { model: request.params.model },
        create: { model: request.params.model, ...request.body },
        update: request.body,
      });
      await auditPlatform(actorOf(request), {
        action: 'pricing.updated',
        resourceType: 'ModelPricing',
        resourceId: row.id,
        metadata: { model: row.model, ...request.body },
      });
      return { ok: true };
    },
  );

  // ── Consumo, erros, saúde ────────────────────────────────────────────────
  app.get(
    '/usage',
    {
      preValidation: platform('platform:usage:read'),
      schema: {
        querystring: z.object({ period: z.enum(['today', '7d', '30d', 'month']).default('30d') }),
      },
    },
    async (request) => {
      const timezone = 'America/Sao_Paulo';
      return {
        periods: await summarizeAiUsageByPeriod({ timezone, includeTests: true }),
        byCompany: await costByCompany(periodStart(request.query.period, timezone)),
      };
    },
  );

  app.get(
    '/errors',
    {
      preValidation: platform('platform:companies:read'),
      schema: {
        querystring: paginationQuerySchema.extend({
          companyId: z.uuid().optional(),
          source: z.string().max(30).optional(),
        }),
      },
    },
    async (request) => {
      const where: Prisma.ErrorLogWhereInput = {
        ...(request.query.companyId ? { companyId: request.query.companyId } : {}),
        ...(request.query.source
          ? { source: request.query.source as Prisma.ErrorLogWhereInput['source'] }
          : {}),
      };
      const [total, items] = await Promise.all([
        systemDb.errorLog.count({ where }),
        systemDb.errorLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (request.query.page - 1) * request.query.pageSize,
          take: request.query.pageSize,
          include: { company: { select: { name: true } } },
        }),
      ]);
      return { items, total, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  app.get('/health', { preValidation: platform('platform:health:read') }, async () =>
    getPlatformHealth(container),
  );

  app.get('/templates', { preValidation: platform('platform:companies:read') }, async () =>
    listBusinessTemplates().map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description,
      tools: template.tools,
    })),
  );

  app.get(
    '/audit',
    {
      preValidation: platform('platform:companies:read'),
      schema: { querystring: paginationQuerySchema.extend({ companyId: z.uuid().optional() }) },
    },
    async (request) => {
      const where: Prisma.AuditLogWhereInput = request.query.companyId
        ? { companyId: request.query.companyId }
        : {};
      const [total, items] = await Promise.all([
        systemDb.auditLog.count({ where }),
        systemDb.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (request.query.page - 1) * request.query.pageSize,
          take: request.query.pageSize,
        }),
      ]);
      return { items, total, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  // ── Administradores da plataforma ────────────────────────────────────────
  app.get('/admins', { preValidation: platform('platform:admins:manage') }, async () =>
    systemDb.user.findMany({
      where: { platformRole: { not: null } },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        isActive: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  );

  app.post(
    '/admins',
    {
      preValidation: platform('platform:admins:manage'),
      schema: {
        body: z.object({
          email: z.email(),
          name: z.string().min(2).max(120),
          password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
          platformRole: z.enum(PLATFORM_ROLES),
        }),
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      const existing = await systemDb.user.findUnique({ where: { email } });
      const user = existing
        ? await systemDb.user.update({
            where: { id: existing.id },
            data: { platformRole: request.body.platformRole },
          })
        : await systemDb.user.create({
            data: {
              email,
              name: request.body.name,
              passwordHash: await hashPassword(request.body.password),
              platformRole: request.body.platformRole,
              mustChangePassword: true,
            },
          });
      await auditPlatform(actorOf(request), {
        action: 'platform_admin.granted',
        resourceType: 'User',
        resourceId: user.id,
        metadata: { role: request.body.platformRole },
      });
      return reply
        .status(201)
        .send({ id: user.id, email: user.email, platformRole: user.platformRole });
    },
  );

  app.delete(
    '/admins/:id',
    { preValidation: platform('platform:admins:manage'), schema: { params: idParamSchema } },
    async (request) => {
      const auth = requireAuthContext(request);
      if (auth.user.id === request.params.id)
        throw new ConflictError('Você não pode remover o próprio acesso.');
      const user = await systemDb.user.findUnique({ where: { id: request.params.id } });
      if (!user?.platformRole) throw new NotFoundError();
      await systemDb.user.update({ where: { id: user.id }, data: { platformRole: null } });
      await auditPlatform(actorOf(request), {
        action: 'platform_admin.revoked',
        resourceType: 'User',
        resourceId: user.id,
      });
      return { ok: true };
    },
  );
};
