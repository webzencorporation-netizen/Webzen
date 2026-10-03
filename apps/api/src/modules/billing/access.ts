import { subscriptionGrantsAccess, type SubscriptionStatus } from '@botsaas/shared';
import type { CompanyDataScope } from '../../context';

export interface BillingAccess {
  allowed: boolean;
  status: SubscriptionStatus | null;
  reason?: string;
}

const STATUS_REASONS: Partial<Record<SubscriptionStatus, string>> = {
  TRIALING: 'O período de teste terminou. Assine um plano para continuar.',
  UNPAID: 'Pagamento pendente. Regularize a assinatura para reativar a IA.',
  INCOMPLETE: 'Assinatura aguardando pagamento. Conclua a contratação do plano.',
  PAUSED: 'Assinatura pausada.',
  CANCELLED: 'Assinatura cancelada. Assine um plano para reativar a IA.',
};

/**
 * A assinatura libera o uso pago (IA)? Empresas sem assinatura são legadas/geridas
 * manualmente pela plataforma e mantêm o comportamento anterior. Assinatura inativa NÃO
 * bloqueia o acesso aos dados: o cliente continua vendo e editando o que é dele.
 */
export async function getBillingAccess(
  scope: Pick<CompanyDataScope, 'db'>,
  now: Date = new Date(),
): Promise<BillingAccess> {
  const subscription = await scope.db.subscription.findFirst({
    select: { status: true, trialEndsAt: true },
  });
  if (!subscription) return { allowed: true, status: null };
  if (subscriptionGrantsAccess(subscription, now)) {
    return { allowed: true, status: subscription.status };
  }
  return {
    allowed: false,
    status: subscription.status,
    reason: STATUS_REASONS[subscription.status] ?? 'Assinatura inativa.',
  };
}
