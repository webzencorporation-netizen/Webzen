import {
  AI_EFFORT_LEVELS,
  AI_EMOJI_USAGE,
  AI_FALLBACK_BEHAVIORS,
  AI_RESPONSE_LENGTHS,
  AI_TONES,
  RateLimitError,
} from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { optionalText, paginationQuerySchema, patchSchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company, requireAuthContext, requireTenant } from '../../../plugins/guards';
import { getTestConversation, resetTestChat, runTestChat } from '../../agent/test-chat';
import * as ai from './service';

const configBody = z.object({
  enabled: z.boolean(),
  agentName: z.string().trim().min(2).max(60),
  personality: optionalText(1000),
  tone: z.enum(AI_TONES),
  responseLength: z.enum(AI_RESPONSE_LENGTHS),
  emojiUsage: z.enum(AI_EMOJI_USAGE),
  additionalInstructions: optionalText(4000),
  customRules: z.array(z.string().trim().min(3).max(300)).max(30),
  greetingMessage: optionalText(500),
  outOfHoursMessage: optionalText(500),
  handoffMessage: optionalText(500),
  fallbackMessage: optionalText(500),
  messageBufferSeconds: z.number().int().min(0).max(30),
  model: z.string().max(80).nullable(),
  maxOutputTokens: z.number().int().min(256).max(16_000),
  effort: z.enum(AI_EFFORT_LEVELS),
  maxToolIterations: z.number().int().min(1).max(12),
  historyMessageLimit: z.number().int().min(4).max(100),
  summaryThreshold: z.number().int().min(10).max(500),
  fallbackBehavior: z.enum(AI_FALLBACK_BEHAVIORS),
  respondOutsideHours: z.boolean(),
  dailyBudgetUsd: z.number().min(0).max(100_000).nullable(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).nullable(),
});

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  // Cada mensagem do "Testar agente" chama a IA paga: limite por EMPRESA (não por IP).
  const testChatLimiter = app.createRateLimit({
    max: app.container.env.AI_TEST_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (request) => `ai-test:${requireTenant(request).companyId}`,
  });

  app.get('/', { preValidation: company('ai:read') }, async (request) =>
    ai.getAiSettings(scopeFromRequest(request)),
  );

  app.patch(
    '/config',
    { preValidation: company('ai:configure'), schema: { body: patchSchema(configBody) } },
    async (request) => ai.updateAiConfig(scopeFromRequest(request), request.body),
  );

  app.put(
    '/tools',
    {
      preValidation: company('ai:configure'),
      schema: { body: z.object({ tools: z.record(z.string().max(60), z.boolean()) }) },
    },
    async (request) => ai.setTools(scopeFromRequest(request), request.body.tools),
  );

  app.get('/prompt-preview', { preValidation: company('ai:prompt_preview') }, async (request) =>
    ai.previewPrompt(scopeFromRequest(request)),
  );

  app.get('/test', { preValidation: company('ai:test') }, async (request) =>
    getTestConversation(
      scopeFromRequest(request),
      requireAuthContext(request).user.id.replaceAll('-', ''),
    ),
  );

  app.post(
    '/test',
    {
      preValidation: company('ai:test'),
      schema: { body: z.object({ message: z.string().trim().min(1).max(2000) }) },
    },
    async (request) => {
      const limit = await testChatLimiter(request);
      if (!limit.isAllowed && limit.isExceeded)
        throw new RateLimitError('Muitos testes seguidos. Aguarde um minuto.');
      return runTestChat(
        scopeFromRequest(request),
        requireAuthContext(request).user.id.replaceAll('-', ''),
        request.body.message,
      );
    },
  );

  app.delete('/test', { preValidation: company('ai:test') }, async (request) => {
    await resetTestChat(
      scopeFromRequest(request),
      requireAuthContext(request).user.id.replaceAll('-', ''),
    );
    return { ok: true };
  });

  app.get(
    '/runs',
    {
      preValidation: company('ai:read'),
      schema: {
        querystring: paginationQuerySchema.extend({
          status: z.enum(['SUCCEEDED', 'FAILED']).optional(),
          conversationId: z.uuid().optional(),
          includeTests: z.coerce.boolean().optional(),
        }),
      },
    },
    async (request) => ai.listAgentRuns(scopeFromRequest(request), request.query),
  );

  app.post('/emergency-stop', { preValidation: company('ai:emergency_stop') }, async (request) => {
    await ai.emergencyStop(scopeFromRequest(request));
    return { ok: true };
  });
};
