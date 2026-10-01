import type { Prisma } from './generated/prisma/client';
import { getSystemDb, type SystemDb } from './client';

/**
 * Modelos com dados de empresa. O client com escopo só permite operar nestes modelos
 * e sempre injeta/valida `companyId`. Há teste que compara esta lista com o schema.
 */
export const TENANT_SCOPED_MODELS = [
  'CompanyMember',
  'Holiday',
  'AIConfiguration',
  'AIToolConfiguration',
  'AgentRun',
  'WhatsAppAccount',
  'WhatsAppTemplate',
  'WebhookEvent',
  'Contact',
  'Tag',
  'ContactTag',
  'ContactNote',
  'ContactMemory',
  'CustomFieldDefinition',
  'LeadStage',
  'Lead',
  'Conversation',
  'Message',
  'MediaAsset',
  'ConversationSummary',
  'Handoff',
  'Service',
  'Product',
  'KnowledgeDocument',
  'KnowledgeEntry',
  'Appointment',
  'Integration',
  'UsageRecord',
  'UsageLimit',
  'Subscription',
  'Invoice',
  'BillingEvent',
  'Invitation',
  'ApiKey',
  'WebhookEndpoint',
  'WebhookDelivery',
  'SupportTicket',
  'SupportTicketMessage',
  'Feedback',
  'CompanyFeatureFlag',
  'DomainEvent',
  'Automation',
  'AutomationRun',
  'Notification',
  'AuditLog',
  'ErrorLog',
] as const satisfies readonly Prisma.ModelName[];

const TENANT_MODEL_SET: ReadonlySet<string> = new Set(TENANT_SCOPED_MODELS);

export class TenantScopeViolation extends Error {
  constructor(message: string) {
    super(`[tenant-scope] ${message}`);
    this.name = 'TenantScopeViolation';
  }
}

type Args = Record<string, unknown> | undefined;

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const DATA_UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopeWhere(model: string, where: unknown, companyId: string): Record<string, unknown> {
  if (where !== undefined && !isRecord(where)) {
    throw new TenantScopeViolation(`where inválido em ${model}`);
  }
  const current = where ?? {};
  if ('companyId' in current && current.companyId !== companyId) {
    throw new TenantScopeViolation(`${model}: tentativa de consultar outra empresa`);
  }
  return { ...current, companyId };
}

function scopeCreateData(model: string, data: unknown, companyId: string): Record<string, unknown> {
  if (!isRecord(data)) throw new TenantScopeViolation(`data inválido em ${model}`);
  if ('company' in data) {
    throw new TenantScopeViolation(
      `${model}: use companyId implícito do escopo, não a relação "company"`,
    );
  }
  if ('companyId' in data && data.companyId !== companyId) {
    throw new TenantScopeViolation(`${model}: tentativa de criar registro em outra empresa`);
  }
  return { ...data, companyId };
}

function assertUpdateKeepsCompany(model: string, data: unknown, companyId: string): void {
  if (!isRecord(data)) return;
  if ('company' in data) {
    throw new TenantScopeViolation(`${model}: não é permitido alterar a relação "company"`);
  }
  if ('companyId' in data && data.companyId !== companyId) {
    throw new TenantScopeViolation(`${model}: não é permitido mover registro para outra empresa`);
  }
}

/** Função pura (testável) que aplica o escopo de empresa aos argumentos de uma operação. */
export function applyTenantScope(
  model: string,
  operation: string,
  args: Args,
  companyId: string,
): Record<string, unknown> {
  if (!TENANT_MODEL_SET.has(model)) {
    throw new TenantScopeViolation(
      `O modelo ${model} não pertence a uma empresa. Use um serviço de plataforma explícito.`,
    );
  }
  const scoped: Record<string, unknown> = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = scopeWhere(model, scoped.where, companyId);
    if (DATA_UPDATE_OPERATIONS.has(operation))
      assertUpdateKeepsCompany(model, scoped.data, companyId);
    return scoped;
  }

  switch (operation) {
    case 'create':
      scoped.data = scopeCreateData(model, scoped.data, companyId);
      return scoped;
    case 'createMany':
    case 'createManyAndReturn': {
      const data = scoped.data;
      scoped.data = Array.isArray(data)
        ? data.map((item) => scopeCreateData(model, item, companyId))
        : scopeCreateData(model, data, companyId);
      return scoped;
    }
    case 'upsert':
      scoped.where = scopeWhere(model, scoped.where, companyId);
      scoped.create = scopeCreateData(model, scoped.create, companyId);
      assertUpdateKeepsCompany(model, scoped.update, companyId);
      return scoped;
    default:
      throw new TenantScopeViolation(`Operação ${operation} não suportada no escopo de empresa`);
  }
}

function buildTenantClient(base: SystemDb, companyId: string) {
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = applyTenantScope(model, operation, args as Args, companyId);
          return query(scoped as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof buildTenantClient>;

/**
 * Client com escopo de empresa: TODA consulta recebe `companyId` automaticamente
 * e qualquer tentativa de acessar outra empresa lança `TenantScopeViolation`.
 *
 * Atenção: `$queryRaw`/`$executeRaw` não passam pela extensão — consultas SQL cruas
 * devem filtrar `companyId` explicitamente (ver knowledge retriever).
 */
export function createTenantClient(companyId: string, base: SystemDb = getSystemDb()): TenantDb {
  if (!companyId) throw new TenantScopeViolation('companyId obrigatório');
  return buildTenantClient(base, companyId);
}
