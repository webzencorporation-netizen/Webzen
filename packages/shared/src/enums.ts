/**
 * Enums de domínio compartilhados entre API e painel.
 * Devem permanecer idênticos aos enums do Prisma (há teste que garante isso em packages/database).
 */

export const PLATFORM_ROLES = ['PLATFORM_OWNER', 'PLATFORM_ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const COMPANY_ROLES = [
  'COMPANY_OWNER',
  'COMPANY_ADMIN',
  'MANAGER',
  'ATTENDANT',
  'VIEWER',
] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const BUSINESS_TEMPLATE_KEYS = [
  'GENERAL',
  'CLINIC',
  'BARBERSHOP_BEAUTY',
  'RESTAURANT',
  'RETAIL_STORE',
  'REAL_ESTATE',
  'LOCAL_SERVICE',
] as const;
export type BusinessTemplateKey = (typeof BUSINESS_TEMPLATE_KEYS)[number];

export const CONVERSATION_MODES = ['AI', 'HUMAN', 'PAUSED'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export const CONVERSATION_STATUSES = ['OPEN', 'WAITING_HUMAN', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/** Quem escreveu a mensagem: cliente, IA, funcionário ou sistema. */
export const MESSAGE_SENDERS = ['CONTACT', 'AI', 'AGENT', 'SYSTEM'] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

export const MESSAGE_TYPES = [
  'TEXT',
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'DOCUMENT',
  'STICKER',
  'LOCATION',
  'CONTACTS',
  'INTERACTIVE',
  'BUTTON',
  'REACTION',
  'TEMPLATE',
  'SYSTEM',
  'UNSUPPORTED',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = [
  'RECEIVED',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const APPOINTMENT_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const USAGE_STATES = ['NORMAL', 'WARNING', 'LIMIT_REACHED'] as const;
export type UsageState = (typeof USAGE_STATES)[number];

/** Entitlements: recursos que cada plano libera (ver plans.ts). Rotas pedem o recurso, nunca o plano. */
export const FEATURE_FLAGS = [
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
  'WHITE_LABEL',
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number];

export const USAGE_METRICS = [
  'AI_CALLS_PER_MONTH',
  'MESSAGES_PER_MONTH',
  'AI_COST_USD_PER_MONTH',
  'USERS',
  'WHATSAPP_NUMBERS',
  'STORAGE_MB',
  'AUTOMATIONS',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'UNPAID',
  'INCOMPLETE',
  'PAUSED',
  'CANCELLED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const INVOICE_STATUSES = ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const AI_TONES = ['FORMAL', 'FRIENDLY', 'CASUAL', 'OBJECTIVE'] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_RESPONSE_LENGTHS = ['SHORT', 'MEDIUM', 'DETAILED'] as const;
export type AiResponseLength = (typeof AI_RESPONSE_LENGTHS)[number];

export const AI_EMOJI_USAGE = ['NEVER', 'MODERATE', 'FREE'] as const;
export type AiEmojiUsage = (typeof AI_EMOJI_USAGE)[number];

export const AI_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type AiEffortLevel = (typeof AI_EFFORT_LEVELS)[number];

/** O que fazer quando a IA falha ou um limite é atingido. */
export const AI_FALLBACK_BEHAVIORS = [
  'HANDOFF_TO_HUMAN',
  'SEND_FALLBACK_MESSAGE',
  'SILENT',
] as const;
export type AiFallbackBehavior = (typeof AI_FALLBACK_BEHAVIORS)[number];

export const AGENT_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const KNOWLEDGE_ENTRY_TYPES = ['TEXT', 'FAQ', 'POLICY', 'COMPANY_INFO', 'DOCUMENT'] as const;
export type KnowledgeEntryType = (typeof KNOWLEDGE_ENTRY_TYPES)[number];

export const INTEGRATION_PROVIDERS = ['WHATSAPP_CLOUD', 'GOOGLE_CALENDAR'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = ['PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'IGNORED',
] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const MEDIA_PROCESSING_STATUSES = [
  'PENDING',
  'DOWNLOADED',
  'PROCESSED',
  'FAILED',
  'SKIPPED',
] as const;
export type MediaProcessingStatus = (typeof MEDIA_PROCESSING_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'HANDOFF_REQUESTED',
  'INTEGRATION_DISCONNECTED',
  'USAGE_WARNING',
  'USAGE_LIMIT_REACHED',
  'AGENT_FAILED',
  'MESSAGE_FAILED',
  'NEW_LEAD',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUTOMATION_TRIGGERS = [
  'contact.created',
  'conversation.created',
  'message.received',
  'lead.stage_changed',
  'appointment.created',
  'appointment.cancelled',
  'handoff.requested',
  'appointment.reminder_due',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
