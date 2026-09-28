import { CloudApiProvider, WhatsAppApiError } from './cloud-api';

/**
 * Homologação da Cloud API com credenciais reais de UM número. Somente leitura, exceto o
 * envio opcional de um template aprovado para um número de teste informado explicitamente.
 * Nunca registra o token; o relatório contém status e identificadores públicos da Meta.
 */

export type WhatsAppCheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface WhatsAppHomologationCheck {
  name: string;
  status: WhatsAppCheckStatus;
  detail: string;
}

export interface WhatsAppHomologationOptions {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string;
  baseUrl: string;
  apiVersion: string;
  /** Configuração do webhook desta instalação (conferência local, sem chamar a Meta). */
  webhook: { publicUrl: string; appSecretSet: boolean; verifyTokenSet: boolean };
  /** Envia o template a este número (E.164 sem "+"), somente quando informado. */
  sendTo?: string;
  template?: { name: string; languageCode: string };
  fetchImpl?: typeof fetch;
}

export interface WhatsAppHomologationReport {
  checks: WhatsAppHomologationCheck[];
  passed: boolean;
}

function describeError(error: unknown): string {
  if (error instanceof WhatsAppApiError) {
    const code = error.graphCode === undefined ? '' : ` código ${error.graphCode}`;
    const trace = error.fbtraceId ? ` (fbtrace_id ${error.fbtraceId})` : '';
    return `HTTP ${error.status}${code}: ${error.message}${trace}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function webhookChecks(
  webhook: WhatsAppHomologationOptions['webhook'],
): WhatsAppHomologationCheck[] {
  const callback = `${webhook.publicUrl.replace(/\/$/, '')}/webhooks/whatsapp`;
  const url = URL.canParse(webhook.publicUrl) ? new URL(webhook.publicUrl) : null;
  const publicHttps =
    url?.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return [
    {
      name: 'URL do webhook',
      status: publicHttps ? 'ok' : 'fail',
      detail: publicHttps
        ? `cadastre ${callback} no app da Meta`
        : `${callback} não é HTTPS público; a Meta exige HTTPS com certificado válido`,
    },
    {
      name: 'segredos do webhook',
      status: webhook.appSecretSet && webhook.verifyTokenSet ? 'ok' : 'fail',
      detail:
        webhook.appSecretSet && webhook.verifyTokenSet
          ? 'WHATSAPP_APP_SECRET e WHATSAPP_WEBHOOK_VERIFY_TOKEN definidos'
          : 'defina WHATSAPP_APP_SECRET e WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    },
  ];
}

export async function runWhatsAppHomologation(
  options: WhatsAppHomologationOptions,
): Promise<WhatsAppHomologationReport> {
  const checks: WhatsAppHomologationCheck[] = webhookChecks(options.webhook);
  const cloud = new CloudApiProvider({
    baseUrl: options.baseUrl,
    apiVersion: options.apiVersion,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const credentials = { phoneNumberId: options.phoneNumberId, accessToken: options.accessToken };

  let numberOk = false;
  try {
    const info = await cloud.getPhoneNumberInfo(credentials);
    numberOk = true;
    checks.push({
      name: 'token e número',
      status: 'ok',
      detail: `${info.displayPhoneNumber ?? '?'} (${info.verifiedName ?? 'nome não verificado'}) na ${options.apiVersion}`,
    });
    const quality = info.qualityRating ?? 'UNKNOWN';
    checks.push({
      name: 'qualidade do número',
      status: quality === 'GREEN' ? 'ok' : 'warn',
      detail: `quality_rating=${quality}`,
    });
  } catch (error) {
    checks.push({ name: 'token e número', status: 'fail', detail: describeError(error) });
  }

  if (!options.wabaId) {
    for (const name of ['inscrição do app na WABA', 'templates aprovados'])
      checks.push({ name, status: 'skipped', detail: 'informe o ID da WABA' });
  } else if (!numberOk) {
    for (const name of ['inscrição do app na WABA', 'templates aprovados'])
      checks.push({ name, status: 'skipped', detail: 'token/número não validados' });
  } else {
    try {
      const apps = await cloud.listSubscribedApps(credentials, options.wabaId);
      checks.push(
        apps.length > 0
          ? {
              name: 'inscrição do app na WABA',
              status: 'ok',
              detail: apps.map((app) => app.name ?? app.id ?? '?').join(', '),
            }
          : {
              name: 'inscrição do app na WABA',
              status: 'fail',
              detail:
                'nenhum app inscrito: a Meta não entregará webhooks (POST /<WABA>/subscribed_apps)',
            },
      );
    } catch (error) {
      checks.push({
        name: 'inscrição do app na WABA',
        status: 'fail',
        detail: describeError(error),
      });
    }
    try {
      const templates = await cloud.listTemplates(credentials, options.wabaId);
      const approved = templates.filter((template) => template.status === 'APPROVED');
      checks.push({
        name: 'templates aprovados',
        status: approved.length > 0 ? 'ok' : 'warn',
        detail:
          approved.length > 0
            ? `${approved.length} de ${templates.length}: ${approved
                .slice(0, 5)
                .map((template) => `${template.name}/${template.language}`)
                .join(', ')}`
            : 'nenhum template aprovado: fora da janela de 24h não será possível iniciar conversa',
      });
    } catch (error) {
      checks.push({ name: 'templates aprovados', status: 'fail', detail: describeError(error) });
    }
  }

  if (!options.sendTo) {
    checks.push({
      name: 'envio de template',
      status: 'skipped',
      detail: 'use --send-to=<número de teste> para enviar',
    });
  } else if (!numberOk) {
    checks.push({
      name: 'envio de template',
      status: 'skipped',
      detail: 'token/número não validados',
    });
  } else {
    const template = options.template ?? { name: 'hello_world', languageCode: 'en_US' };
    try {
      const sent = await cloud.sendTemplate(credentials, {
        to: options.sendTo,
        templateName: template.name,
        languageCode: template.languageCode,
      });
      checks.push({
        name: 'envio de template',
        status: 'ok',
        detail: `aceito (${sent.externalId}); confirme entrega pelo webhook de status`,
      });
    } catch (error) {
      checks.push({ name: 'envio de template', status: 'fail', detail: describeError(error) });
    }
  }

  return { checks, passed: checks.every((check) => check.status !== 'fail') };
}
