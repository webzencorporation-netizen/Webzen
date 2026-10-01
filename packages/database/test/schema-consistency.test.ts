import fs from 'node:fs';
import path from 'node:path';
import * as shared from '@botsaas/shared';
import { describe, expect, it } from 'vitest';
import * as prismaEnums from '../src/generated/prisma/enums';
import { TENANT_SCOPED_MODELS } from '../src/tenant';

const schema = fs.readFileSync(
  path.resolve(import.meta.dirname, '../prisma/schema.prisma'),
  'utf8',
);

function modelsWithCompanyId(): string[] {
  const models: string[] = [];
  const modelRegex = /model (\w+) \{([\s\S]*?)\n\}/g;
  for (const match of schema.matchAll(modelRegex)) {
    const [, name, body] = match;
    if (name && body && /^\s+companyId\s+String/m.test(body)) models.push(name);
  }
  return models;
}

describe('consistência do schema', () => {
  it('todo modelo com companyId está na lista de modelos com escopo de empresa', () => {
    const expected = modelsWithCompanyId().sort();
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(expected);
  });

  it.each([
    ['PlatformRole', shared.PLATFORM_ROLES],
    ['CompanyRole', shared.COMPANY_ROLES],
    ['CompanyStatus', shared.COMPANY_STATUSES],
    ['BusinessTemplateKey', shared.BUSINESS_TEMPLATE_KEYS],
    ['ConversationMode', shared.CONVERSATION_MODES],
    ['ConversationStatus', shared.CONVERSATION_STATUSES],
    ['MessageDirection', shared.MESSAGE_DIRECTIONS],
    ['MessageSender', shared.MESSAGE_SENDERS],
    ['MessageType', shared.MESSAGE_TYPES],
    ['MessageStatus', shared.MESSAGE_STATUSES],
    ['AppointmentStatus', shared.APPOINTMENT_STATUSES],
    ['FeatureFlagKey', shared.FEATURE_FLAGS],
    ['AiTone', shared.AI_TONES],
    ['AiResponseLength', shared.AI_RESPONSE_LENGTHS],
    ['AiEmojiUsage', shared.AI_EMOJI_USAGE],
    ['AiFallbackBehavior', shared.AI_FALLBACK_BEHAVIORS],
    ['AgentRunStatus', shared.AGENT_RUN_STATUSES],
    ['KnowledgeEntryType', shared.KNOWLEDGE_ENTRY_TYPES],
    ['IntegrationProvider', shared.INTEGRATION_PROVIDERS],
    ['IntegrationStatus', shared.INTEGRATION_STATUSES],
    ['WebhookEventStatus', shared.WEBHOOK_EVENT_STATUSES],
    ['MediaProcessingStatus', shared.MEDIA_PROCESSING_STATUSES],
    ['NotificationType', shared.NOTIFICATION_TYPES],
    ['UsageMetric', shared.USAGE_METRICS],
    ['SubscriptionStatus', shared.SUBSCRIPTION_STATUSES],
    ['BillingInterval', shared.BILLING_INTERVALS],
    ['InvoiceStatus', shared.INVOICE_STATUSES],
    ['TicketStatus', shared.TICKET_STATUSES],
    ['TicketPriority', shared.TICKET_PRIORITIES],
    ['TicketCategory', shared.TICKET_CATEGORIES],
    ['FeedbackCategory', shared.FEEDBACK_CATEGORIES],
  ] as const)('enum %s idêntico ao do pacote shared', (name, values) => {
    const prismaEnum = (prismaEnums as unknown as Record<string, Record<string, string>>)[name];
    expect(prismaEnum, `enum ${name} ausente no Prisma`).toBeDefined();
    expect(Object.values(prismaEnum ?? {}).sort()).toEqual([...values].sort());
  });
});
