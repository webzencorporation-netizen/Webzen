import { randomUUID } from 'node:crypto';
import { buildGoogleAuthUrl, exchangeGoogleCode } from '@botsaas/integrations';
import type { Prisma } from '@botsaas/database';
import { ConflictError, IntegrationError, NotFoundError, ValidationError } from '@botsaas/shared';
import { normalizePhone, type InboundMessage } from '@botsaas/whatsapp';
import { requireSecrets } from '../../../container';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { hmacSha256Hex, maskSecret, safeEqual } from '../../../lib/crypto';
import { notify } from '../../../lib/notifications';
import { resolveCredentials } from '../../messaging/accounts';
import { ingestInboundMessage } from '../../messaging/inbound';
import { assertWithinLimit } from '../../usage/limits';
import { isPhoneNumberIdTaken } from '../../whatsapp-registry/service';

export async function getIntegrations(scope: CompanyScope) {
  const { env, providers } = scope.container;
  const [accounts, google, templates] = await Promise.all([
    scope.db.whatsAppAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    scope.db.integration.findFirst({ where: { provider: 'GOOGLE_CALENDAR' } }),
    scope.db.whatsAppTemplate.count(),
  ]);
  return {
    whatsapp: {
      provider: providers.messaging.name,
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
      webhookUrl: `${env.API_PUBLIC_URL}/webhooks/whatsapp`,
      webhookConfigured: Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
      embeddedSignupAvailable: Boolean(env.META_APP_ID && env.META_EMBEDDED_SIGNUP_CONFIG_ID),
      templatesCount: templates,
      accounts: accounts.map((account) => ({
        id: account.id,
        phoneNumberId: account.phoneNumberId,
        wabaId: account.wabaId,
        displayPhoneNumber: account.displayPhoneNumber,
        verifiedName: account.verifiedName,
        status: account.status,
        qualityRating: account.qualityRating,
        isDefault: account.isDefault,
        lastError: account.lastError,
        lastWebhookAt: account.lastWebhookAt,
        connectedAt: account.connectedAt,
        tokenConfigured: Boolean(account.accessTokenEncrypted),
        tokenPreview: account.accessTokenEncrypted ? maskSecret('token-configurado') : null,
      })),
    },
    googleCalendar: {
      available: Boolean(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI,
      ),
      status: google?.status ?? 'DISCONNECTED',
      calendarId: (google?.config as { calendarId?: string } | null)?.calendarId ?? null,
      lastSyncAt: google?.lastSyncAt ?? null,
      lastError: google?.lastError ?? null,
    },
  };
}

export async function addWhatsAppAccount(
  scope: CompanyScope,
  input: {
    phoneNumberId: string;
    wabaId?: string | null;
    accessToken?: string | null;
    displayPhoneNumber?: string | null;
  },
) {
  await assertWithinLimit(scope, 'WHATSAPP_NUMBERS');
  if (await isPhoneNumberIdTaken(input.phoneNumberId))
    throw new ConflictError('Este número já está cadastrado na plataforma.');
  const { providers } = scope.container;
  const isMock = providers.messaging.name === 'mock';
  if (!isMock && !input.accessToken)
    throw new ValidationError('Informe o token de acesso do número.');

  let info: { displayPhoneNumber?: string; verifiedName?: string; qualityRating?: string };
  try {
    info = await providers.messaging.getPhoneNumberInfo({
      phoneNumberId: input.phoneNumberId,
      accessToken: input.accessToken ?? 'mock-token',
    });
  } catch (error) {
    throw new IntegrationError(
      `Não foi possível validar o número na Meta: ${error instanceof Error ? error.message : 'erro'}`,
    );
  }
  const hasDefault = (await scope.db.whatsAppAccount.count({ where: { isDefault: true } })) > 0;
  const account = await scope.db.whatsAppAccount.create({
    data: {
      companyId: scope.companyId,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId ?? null,
      accessTokenEncrypted: input.accessToken
        ? requireSecrets(scope.container).encrypt(input.accessToken)
        : null,
      displayPhoneNumber: input.displayPhoneNumber ?? info.displayPhoneNumber ?? null,
      verifiedName: info.verifiedName ?? null,
      qualityRating: info.qualityRating ?? null,
      status: 'CONNECTED',
      isDefault: !hasDefault,
      connectedAt: new Date(),
    },
  });
  await audit(scope, {
    action: 'integration.connected',
    resourceType: 'WhatsAppAccount',
    resourceId: account.id,
    metadata: { phoneNumberId: account.phoneNumberId, provider: providers.messaging.name },
  });
  return { id: account.id };
}

export async function updateWhatsAppAccount(
  scope: CompanyScope,
  id: string,
  input: { accessToken?: string; isDefault?: boolean; wabaId?: string | null },
) {
  const account = await scope.db.whatsAppAccount.findUnique({ where: { id } });
  if (!account) throw new NotFoundError('Número não encontrado.');
  if (input.isDefault)
    await scope.db.whatsAppAccount.updateMany({
      where: { id: { not: id } },
      data: { isDefault: false },
    });
  await scope.db.whatsAppAccount.update({
    where: { id },
    data: {
      ...(input.accessToken
        ? {
            accessTokenEncrypted: requireSecrets(scope.container).encrypt(input.accessToken),
            status: 'CONNECTED',
            lastError: null,
          }
        : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.wabaId !== undefined ? { wabaId: input.wabaId } : {}),
    },
  });
  if (input.accessToken)
    await audit(scope, {
      action: 'integration.credentials_updated',
      resourceType: 'WhatsAppAccount',
      resourceId: id,
    });
  return verifyWhatsAppAccount(scope, id);
}

export async function verifyWhatsAppAccount(scope: CompanyScope, id: string) {
  const account = await scope.db.whatsAppAccount.findUnique({ where: { id } });
  if (!account) throw new NotFoundError('Número não encontrado.');
  try {
    const { credentials } = await resolveCredentials(scope, id);
    const info = await scope.container.providers.messaging.getPhoneNumberInfo(credentials);
    await scope.db.whatsAppAccount.update({
      where: { id },
      data: {
        status: 'CONNECTED',
        lastError: null,
        qualityRating: info.qualityRating ?? null,
        verifiedName: info.verifiedName ?? account.verifiedName,
        displayPhoneNumber: info.displayPhoneNumber ?? account.displayPhoneNumber,
      },
    });
    return { status: 'CONNECTED' as const };
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'erro').slice(0, 300);
    await scope.db.whatsAppAccount.update({
      where: { id },
      data: { status: 'ERROR', lastError: message },
    });
    await notify(scope, {
      type: 'INTEGRATION_DISCONNECTED',
      severity: 'CRITICAL',
      title: 'WhatsApp com problema de conexão',
      body: message,
      link: '/app/integrations',
    });
    return { status: 'ERROR' as const, error: message };
  }
}

export async function removeWhatsAppAccount(scope: CompanyScope, id: string) {
  const account = await scope.db.whatsAppAccount.findUnique({ where: { id } });
  if (!account) throw new NotFoundError('Número não encontrado.');
  await scope.db.whatsAppAccount.delete({ where: { id } });
  await audit(scope, {
    action: 'integration.removed',
    resourceType: 'WhatsAppAccount',
    resourceId: id,
    metadata: { phoneNumberId: account.phoneNumberId },
  });
}

export async function syncTemplates(scope: CompanyScope, accountId: string) {
  const account = await scope.db.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError('Número não encontrado.');
  if (!account.wabaId && scope.container.providers.messaging.name !== 'mock')
    throw new ValidationError(
      'Informe o ID da conta WhatsApp Business (WABA) para sincronizar templates.',
    );
  const { credentials } = await resolveCredentials(scope, accountId);
  const templates = await scope.container.providers.messaging.listTemplates(
    credentials,
    account.wabaId ?? 'mock-waba',
  );
  for (const template of templates) {
    await scope.db.whatsAppTemplate.upsert({
      where: {
        companyId_name_language: {
          companyId: scope.companyId,
          name: template.name,
          language: template.language,
        },
      },
      create: {
        companyId: scope.companyId,
        whatsappAccountId: accountId,
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        components: template.components as Prisma.InputJsonValue,
        externalId: template.id,
      },
      update: {
        category: template.category,
        status: template.status,
        components: template.components as Prisma.InputJsonValue,
        externalId: template.id,
      },
    });
  }
  return { synced: templates.length };
}

export function listTemplates(scope: CompanyScope) {
  return scope.db.whatsAppTemplate.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
}

/**
 * Simulador de WhatsApp (somente com provider mock): gera uma mensagem de cliente que segue
 * exatamente o mesmo fluxo de ingestão do webhook real.
 */
export async function simulateInboundMessage(
  scope: CompanyScope,
  input: { from: string; name?: string | null; text: string },
) {
  if (scope.container.providers.messaging.name !== 'mock')
    throw new ValidationError(
      'O simulador só está disponível com o provider de WhatsApp em modo de desenvolvimento.',
    );
  const account =
    (await scope.db.whatsAppAccount.findFirst({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })) ??
    (await scope.db.whatsAppAccount.create({
      data: {
        companyId: scope.companyId,
        phoneNumberId: `sandbox-${scope.companyId}`,
        displayPhoneNumber: '+55 00 00000-0000',
        verifiedName: 'Sandbox (simulação)',
        status: 'CONNECTED',
        isDefault: true,
        connectedAt: new Date(),
      },
    }));
  const from = normalizePhone(input.from);
  const message: InboundMessage = {
    externalId: `wamid.sim.${randomUUID()}`,
    from,
    timestamp: new Date(),
    type: 'TEXT',
    text: input.text,
  };
  return ingestInboundMessage(scope, {
    accountId: account.id,
    contact: { waId: from, profileName: input.name ?? undefined },
    message,
  });
}

// ── Google Calendar (OAuth) ────────────────────────────────────────────────

const STATE_TTL_MS = 10 * 60_000;

function googleConfig(scope: CompanyScope) {
  const { env } = scope.container;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new ValidationError('Integração com Google não configurada na plataforma.');
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

function signState(secret: string, payload: string): string {
  return `${Buffer.from(payload).toString('base64url')}.${hmacSha256Hex(secret, payload)}`;
}

export function verifyState(
  secret: string,
  state: string,
): { companyId: string; userId: string } | null {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  if (!safeEqual(signature, hmacSha256Hex(secret, payload))) return null;
  const [companyId, userId, expires] = payload.split(':');
  if (!companyId || !userId || Number(expires) < Date.now()) return null;
  return { companyId, userId };
}

export function startGoogleConnect(scope: CompanyScope) {
  const config = googleConfig(scope);
  const secret = scope.container.env.ENCRYPTION_KEY;
  if (!secret || !scope.actor.userId) throw new ValidationError('Criptografia não configurada.');
  const state = signState(
    secret,
    `${scope.companyId}:${scope.actor.userId}:${Date.now() + STATE_TTL_MS}`,
  );
  return { url: buildGoogleAuthUrl(config, state) };
}

export async function completeGoogleConnect(scope: CompanyScope, code: string) {
  const tokens = await exchangeGoogleCode(googleConfig(scope), code);
  const secrets = requireSecrets(scope.container);
  const integration = await scope.db.integration.upsert({
    where: { companyId_provider: { companyId: scope.companyId, provider: 'GOOGLE_CALENDAR' } },
    create: {
      companyId: scope.companyId,
      provider: 'GOOGLE_CALENDAR',
      status: 'CONNECTED',
      config: { calendarId: 'primary' },
      credentialsEncrypted: secrets.encrypt(JSON.stringify(tokens)),
      connectedAt: new Date(),
    },
    update: {
      status: 'CONNECTED',
      credentialsEncrypted: secrets.encrypt(JSON.stringify(tokens)),
      connectedAt: new Date(),
      lastError: null,
    },
  });
  await audit(scope, {
    action: 'integration.connected',
    resourceType: 'Integration',
    resourceId: integration.id,
    metadata: { provider: 'GOOGLE_CALENDAR' },
  });
}

export async function disconnectGoogle(scope: CompanyScope) {
  const integration = await scope.db.integration.findFirst({
    where: { provider: 'GOOGLE_CALENDAR' },
  });
  if (!integration) return;
  await scope.db.integration.update({
    where: { id: integration.id },
    data: { status: 'DISCONNECTED', credentialsEncrypted: null },
  });
  await audit(scope, {
    action: 'integration.removed',
    resourceType: 'Integration',
    resourceId: integration.id,
    metadata: { provider: 'GOOGLE_CALENDAR' },
  });
}
