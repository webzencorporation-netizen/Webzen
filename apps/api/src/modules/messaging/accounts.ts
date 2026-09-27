import { NotFoundError, WhatsAppError } from '@botsaas/shared';
import type { WhatsAppCredentials } from '@botsaas/whatsapp';
import type { CompanyScope } from '../../context';

/** Resolve credenciais descriptografadas de um número (somente no backend). */
export async function resolveCredentials(
  scope: CompanyScope,
  accountId?: string | null,
): Promise<{ accountId: string; credentials: WhatsAppCredentials }> {
  const account = accountId
    ? await scope.db.whatsAppAccount.findUnique({ where: { id: accountId } })
    : await scope.db.whatsAppAccount.findFirst({
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
  if (!account) throw new NotFoundError('Nenhum número de WhatsApp configurado.');
  if (scope.container.providers.messaging.name === 'mock') {
    return {
      accountId: account.id,
      credentials: { phoneNumberId: account.phoneNumberId, accessToken: 'mock-token' },
    };
  }
  if (!account.accessTokenEncrypted || !scope.container.secrets) {
    throw new WhatsAppError('Número de WhatsApp sem token de acesso configurado.');
  }
  return {
    accountId: account.id,
    credentials: {
      phoneNumberId: account.phoneNumberId,
      accessToken: scope.container.secrets.decrypt(account.accessTokenEncrypted),
    },
  };
}
