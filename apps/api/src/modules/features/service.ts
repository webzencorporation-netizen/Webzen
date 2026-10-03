import type { FeatureFlagKey } from '@botsaas/database';
import { FEATURE_FLAGS, FEATURE_LABELS, FeatureDisabledError } from '@botsaas/shared';
import type { FastifyRequest } from 'fastify';
import type { CompanyDataScope, CompanyScope } from '../../context';
import { requireTenant } from '../../plugins/guards';

/** Recursos efetivos: recursos do plano + sobrescritas da empresa. Sem assinatura = recursos básicos. */
export async function getEnabledFeatures(
  scope: Pick<CompanyDataScope, 'db'>,
): Promise<Set<FeatureFlagKey>> {
  const [subscription, overrides] = await Promise.all([
    scope.db.subscription.findFirst({ include: { plan: { select: { features: true } } } }),
    scope.db.companyFeatureFlag.findMany(),
  ]);
  const enabled = new Set<FeatureFlagKey>(subscription?.plan.features ?? ['AI_AGENT', 'CRM']);
  for (const override of overrides) {
    if (override.enabled) enabled.add(override.flag);
    else enabled.delete(override.flag);
  }
  return enabled;
}

export async function describeFeatures(scope: CompanyScope) {
  const enabled = await getEnabledFeatures(scope);
  return FEATURE_FLAGS.map((flag) => ({
    flag,
    label: FEATURE_LABELS[flag],
    enabled: enabled.has(flag),
  }));
}

export async function assertFeature(
  scope: Pick<CompanyDataScope, 'db'>,
  flag: FeatureFlagKey,
): Promise<void> {
  const enabled = await getEnabledFeatures(scope);
  if (!enabled.has(flag))
    throw new FeatureDisabledError(
      `O recurso "${FEATURE_LABELS[flag]}" não está disponível no plano atual.`,
    );
}

/** preValidation: exige recurso habilitado (use após o guard `company`). */
export function feature(flag: FeatureFlagKey) {
  return async (request: FastifyRequest): Promise<void> => {
    await assertFeature(requireTenant(request), flag);
  };
}
