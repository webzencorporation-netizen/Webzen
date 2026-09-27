import { AUTOMATION_TRIGGERS } from '@botsaas/shared';
import { z } from 'zod';

/**
 * Automações simples: gatilho (evento interno) + condições + ações.
 * Não é um Zapier — o catálogo de ações é pequeno, validado e extensível.
 */
export const conditionSchema = z.object({
  field: z
    .string()
    .min(1)
    .max(100)
    .describe('Caminho no contexto, ex.: contact.name, payload.reason, lead.stageKey'),
  op: z.enum(['eq', 'neq', 'contains', 'exists', 'not_exists']),
  value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
});

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_tag'), tagName: z.string().min(1).max(50) }),
  z.object({
    type: z.literal('notify_team'),
    title: z.string().min(1).max(120),
    body: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('send_template'),
    templateName: z.string().min(1).max(100),
    languageCode: z.string().min(2).max(10),
    bodyParameters: z.array(z.string().max(200)).max(10).default([]),
  }),
  z.object({ type: z.literal('send_message'), text: z.string().min(1).max(1000) }),
  z.object({ type: z.literal('move_lead_stage'), stageKey: z.string().min(1).max(50) }),
  z.object({ type: z.literal('create_note'), text: z.string().min(1).max(1000) }),
]);

export const automationInputSchema = z.object({
  name: z.string().min(2).max(120),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
  isActive: z.boolean().default(true),
});

export type AutomationCondition = z.infer<typeof conditionSchema>;
export type AutomationAction = z.infer<typeof actionSchema>;
export type AutomationInput = z.infer<typeof automationInputSchema>;
