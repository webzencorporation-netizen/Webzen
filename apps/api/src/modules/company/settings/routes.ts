import { getBusinessTemplate, listBusinessTemplates, TOOL_METADATA } from '@botsaas/ai';
import { BUSINESS_TEMPLATE_KEYS, weeklyScheduleSchema } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getOwnCompany } from '../../../lib/company-record';
import { idParamSchema, optionalText } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import { describeFeatures } from '../../features/service';
import { getUsageStatus } from '../../usage/limits';
import { applyBusinessTemplate } from '../templates/service';
import * as settings from './service';

const stepKeys = settings.ONBOARDING_STEPS.map((step) => step.key) as [
  settings.OnboardingStepKey,
  ...settings.OnboardingStepKey[],
];

const addressSchema = z
  .object({
    street: z.string().max(200).optional(),
    number: z.string().max(20).optional(),
    complement: z.string().max(100).optional(),
    district: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    zip: z.string().max(20).optional(),
    country: z.string().max(50).optional(),
    mapsUrl: z.url().max(500).optional().or(z.literal('')),
  })
  .nullable();

const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido');

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { preValidation: company('company:read') }, async (request) =>
    settings.getCompanyProfile(scopeFromRequest(request)),
  );

  app.patch(
    '/',
    {
      preValidation: company('company:update'),
      schema: {
        body: z.object({
          name: z.string().min(2).max(120).optional(),
          segment: optionalText(100),
          legalName: optionalText(200),
          document: optionalText(30),
          phone: optionalText(30),
          email: z.email().max(200).nullish(),
          website: z
            .url()
            .max(300)
            .nullish()
            .or(z.literal('').transform(() => null)),
          description: optionalText(2000),
          address: addressSchema.optional(),
          timezone: timezoneSchema.optional(),
          messageRetentionDays: z.number().int().min(30).max(3650).nullish(),
        }),
      },
    },
    async (request) => settings.updateCompanyProfile(scopeFromRequest(request), request.body),
  );

  app.put(
    '/business-hours',
    {
      preValidation: company('settings:manage'),
      schema: { body: z.object({ schedule: weeklyScheduleSchema }) },
    },
    async (request) =>
      settings.updateBusinessHours(scopeFromRequest(request), request.body.schedule),
  );

  app.put(
    '/holidays',
    {
      preValidation: company('settings:manage'),
      schema: {
        body: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          name: z.string().min(2).max(100),
          closed: z.boolean(),
          open: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullish(),
          close: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullish(),
        }),
      },
    },
    async (request) => settings.upsertHoliday(scopeFromRequest(request), request.body),
  );

  app.delete(
    '/holidays/:id',
    { preValidation: company('settings:manage'), schema: { params: idParamSchema } },
    async (request) => {
      await settings.deleteHoliday(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get('/onboarding', { preValidation: company('company:read') }, async (request) =>
    settings.getOnboarding(scopeFromRequest(request)),
  );

  app.put(
    '/onboarding',
    {
      preValidation: company('settings:manage'),
      schema: {
        body: z.object({
          step: z.enum(stepKeys),
          action: z.enum(['complete', 'skip', 'reopen']),
          current: z.enum(stepKeys).optional(),
        }),
      },
    },
    async (request) => settings.saveOnboardingProgress(scopeFromRequest(request), request.body),
  );

  app.post(
    '/activate',
    {
      preValidation: company('settings:manage'),
      schema: { body: z.object({ enableAi: z.boolean().default(true) }) },
    },
    async (request) => settings.activateCompany(scopeFromRequest(request), request.body),
  );

  app.get('/features', { preValidation: company('company:read') }, async (request) =>
    describeFeatures(scopeFromRequest(request)),
  );

  app.get('/usage-status', { preValidation: company('company:read') }, async (request) =>
    getUsageStatus(scopeFromRequest(request)),
  );

  /** Template atual com sugestões (FAQ, atributos de catálogo, dicas de onboarding). */
  app.get('/template', { preValidation: company('company:read') }, async (request) => {
    const own = await getOwnCompany(scopeFromRequest(request));
    const template = getBusinessTemplate(own.templateKey);
    return {
      key: template.key,
      name: template.name,
      description: template.description,
      catalog: template.catalog,
      suggestedFaqs: template.suggestedFaqs,
      onboardingHints: template.onboardingHints,
      tools: template.tools.map((tool) => ({ name: tool, label: TOOL_METADATA[tool].label })),
    };
  });

  app.get('/templates', { preValidation: company('company:read') }, async () =>
    listBusinessTemplates().map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description,
    })),
  );

  app.post(
    '/template',
    {
      preValidation: company('settings:manage'),
      schema: {
        body: z.object({
          templateKey: z.enum(BUSINESS_TEMPLATE_KEYS),
          includeAgentDefaults: z.boolean().default(false),
        }),
      },
    },
    async (request) => {
      await applyBusinessTemplate(scopeFromRequest(request), request.body.templateKey, {
        includeAgentDefaults: request.body.includeAgentDefaults,
      });
      return { ok: true };
    },
  );
};
