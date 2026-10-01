import { randomBytes } from 'node:crypto';
import { systemDb } from '@botsaas/database';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  permissionsForRole,
  type ApiScope,
} from '@botsaas/shared';
import type { AppContainer } from '../../container';
import type { CompanyScope } from '../../context';
import { audit } from '../../lib/audit';
import { sha256 } from '../../lib/crypto';
import { createTenantClient } from '@botsaas/database';
import { getBillingAccess } from '../billing/access';
import { getEnabledFeatures } from '../features/service';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_KEYS_PER_COMPANY = 20;

function randomKeyBody(length = 40): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export function keyPrefix(container: AppContainer): string {
  return container.env.NODE_ENV === 'production' ? 'wz_live_' : 'wz_test_';
}

/** "wz_live_••••••••4k82": identifica a chave sem permitir reconstruí-la. */
export function maskedKey(prefix: string, last4: string): string {
  return `${prefix}${'•'.repeat(8)}${last4}`;
}

const publicKey = (key: {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) => ({
  id: key.id,
  name: key.name,
  masked: maskedKey(key.prefix, key.last4),
  scopes: key.scopes,
  lastUsedAt: key.lastUsedAt,
  revokedAt: key.revokedAt,
  createdAt: key.createdAt,
});

export async function listApiKeys(scope: CompanyScope) {
  const keys = await scope.db.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  return keys.map(publicKey);
}

/** Cria a chave e devolve o valor completo UMA vez. O banco guarda só o hash. */
export async function createApiKey(
  scope: CompanyScope,
  input: { name: string; scopes: ApiScope[] },
) {
  const active = await scope.db.apiKey.count({ where: { revokedAt: null } });
  if (active >= MAX_KEYS_PER_COMPANY) {
    throw new AuthorizationError(
      `Limite de ${MAX_KEYS_PER_COMPANY} chaves ativas. Revogue uma antes de criar outra.`,
    );
  }
  const prefix = keyPrefix(scope.container);
  const secret = `${prefix}${randomKeyBody()}`;
  const key = await scope.db.apiKey.create({
    data: {
      companyId: scope.companyId,
      name: input.name.trim(),
      prefix,
      keyHash: sha256(secret),
      last4: secret.slice(-4),
      scopes: [...new Set(input.scopes)],
      createdById: scope.actor.userId ?? null,
    },
  });
  await audit(scope, {
    action: 'api_key.created',
    resourceType: 'ApiKey',
    resourceId: key.id,
    metadata: { name: key.name, scopes: key.scopes },
  });
  return { ...publicKey(key), secret };
}

export async function updateApiKey(
  scope: CompanyScope,
  id: string,
  input: { name?: string; scopes?: ApiScope[] },
) {
  const key = await scope.db.apiKey.findUnique({ where: { id } });
  if (!key || key.revokedAt) throw new NotFoundError('Chave não encontrada.');
  const updated = await scope.db.apiKey.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.scopes !== undefined ? { scopes: [...new Set(input.scopes)] } : {}),
    },
  });
  await audit(scope, {
    action: 'api_key.updated',
    resourceType: 'ApiKey',
    resourceId: id,
    metadata: { fields: Object.keys(input) },
  });
  return publicKey(updated);
}

export async function revokeApiKey(scope: CompanyScope, id: string) {
  const key = await scope.db.apiKey.findUnique({ where: { id } });
  if (!key || key.revokedAt) throw new NotFoundError('Chave não encontrada.');
  await scope.db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(scope, {
    action: 'api_key.revoked',
    resourceType: 'ApiKey',
    resourceId: id,
    metadata: { name: key.name },
  });
}

export interface ApiKeyContext {
  keyId: string;
  companyId: string;
  scopes: Set<string>;
}

/**
 * Autentica `Authorization: Bearer wz_...`. Recusa chave revogada, empresa suspensa ou
 * cancelada e plano sem o recurso de API (rebaixar o plano desliga as chaves na hora).
 * Mensagem única para chave inexistente/revogada: não revela qual chave já existiu.
 */
export async function authenticateApiKey(
  container: AppContainer,
  header: string | undefined,
  ip: string,
  now: Date = new Date(),
): Promise<ApiKeyContext> {
  const match = header?.match(/^Bearer\s+(wz_(?:live|test)_[A-Za-z0-9]{20,80})$/);
  if (!match?.[1]) throw new AuthenticationError('Chave de API ausente ou inválida.');
  const key = await systemDb.apiKey.findUnique({
    where: { keyHash: sha256(match[1]) },
    include: { company: { select: { status: true } } },
  });
  if (!key || key.revokedAt) throw new AuthenticationError('Chave de API ausente ou inválida.');
  if (key.prefix !== keyPrefix(container))
    throw new AuthenticationError('Chave de API de outro ambiente.');
  if (key.company.status === 'SUSPENDED' || key.company.status === 'CANCELLED') {
    throw new AuthorizationError('Empresa sem acesso à API.');
  }
  const db = createTenantClient(key.companyId);
  const [features, billing] = await Promise.all([
    getEnabledFeatures({ db }),
    getBillingAccess({ db }, now),
  ]);
  if (!features.has('API_ACCESS') || !billing.allowed) {
    throw new AuthorizationError('O plano atual não inclui acesso à API.');
  }
  // Atualiza o "último uso" no máximo a cada minuto (evita uma escrita por requisição).
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > 60_000) {
    await systemDb.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: now, lastUsedIp: ip },
    });
  }
  return { keyId: key.id, companyId: key.companyId, scopes: new Set(key.scopes) };
}

/** Escopo de empresa para a API pública: ator "API" e permissões de dono, limitadas pelos escopos da chave. */
export function apiKeyScope(
  container: AppContainer,
  context: ApiKeyContext,
  requestId: string,
  ip: string,
): CompanyScope {
  return {
    companyId: context.companyId,
    db: createTenantClient(context.companyId),
    actor: { type: 'SYSTEM', label: `API (${context.keyId.slice(0, 8)})` },
    role: null,
    permissions: new Set(permissionsForRole('COMPANY_OWNER')),
    isSupportMode: false,
    requestId,
    ip,
    container,
  };
}
