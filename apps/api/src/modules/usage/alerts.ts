import { systemDb } from '@botsaas/database';
import { usageThresholdReached, type UsageMetric } from '@botsaas/shared';
import type { AppContainer } from '../../container';
import { systemScope } from '../../lib/scope';
import { monthStart } from '../../lib/time';
import { queueEmail } from '../email/service';
import { emailTemplates } from '../email/templates';
import { getUsageStatus } from './limits';

/** Métricas que acompanham o mês; as demais (usuários, números...) são capacidade fixa. */
const MONTHLY_METRICS: ReadonlySet<UsageMetric> = new Set([
  'AI_CALLS_PER_MONTH',
  'MESSAGES_PER_MONTH',
  'AI_COST_USD_PER_MONTH',
]);

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export interface UsageAlertResult {
  companies: number;
  created: number;
}

/**
 * Avisos de consumo a 70%, 90% e 100% do limite do plano (centralizados em
 * USAGE_ALERT_THRESHOLDS). Roda no worker; cada aviso tem chave de deduplicação por
 * métrica + limiar + mês, então rodar de novo (ou em duas réplicas) não repete a notificação.
 */
export async function checkUsageAlerts(
  container: AppContainer,
  now: Date = new Date(),
): Promise<UsageAlertResult> {
  const companies = await systemDb.company.findMany({
    where: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
    select: { id: true, name: true, timezone: true },
  });
  let created = 0;
  for (const company of companies) {
    const scope = systemScope(container, company.id);
    const period = monthStart(company.timezone, now).toISOString().slice(0, 7);
    const status = await getUsageStatus(scope, now);
    for (const metric of status.metrics) {
      const threshold = usageThresholdReached(metric.current, metric.limit);
      if (threshold === 0 || metric.limit === null) continue;
      const dedupeKey = `usage:${metric.metric}:${threshold}:${MONTHLY_METRICS.has(metric.metric) ? period : 'capacity'}`;
      const existing = await scope.db.notification.findFirst({
        where: { data: { path: ['dedupeKey'], equals: dedupeKey } },
        select: { id: true },
      });
      if (existing) continue;
      const reached = threshold >= 100;
      const usage = `${numberFormat.format(metric.current)} de ${numberFormat.format(metric.limit)}`;
      await scope.db.notification.create({
        data: {
          type: reached ? 'USAGE_LIMIT_REACHED' : 'USAGE_WARNING',
          severity: reached ? 'CRITICAL' : 'WARNING',
          title: reached
            ? `Você atingiu o limite do plano: ${metric.label}`
            : `Você usou ${threshold}% do limite: ${metric.label}`,
          body: reached
            ? `Uso atual: ${usage}. Faça upgrade do plano para continuar sem interrupções.`
            : `Uso atual: ${usage}.`,
          link: '/app/settings/billing',
          data: { dedupeKey, metric: metric.metric, threshold },
        },
      });
      created += 1;
      // Por e-mail só os limiares que pedem ação (90% e 100%), para quem decide o plano.
      if (threshold >= 90) {
        const admins = await scope.db.companyMember.findMany({
          where: { isActive: true, role: { in: ['COMPANY_OWNER', 'COMPANY_ADMIN'] } },
          select: { user: { select: { email: true, isActive: true } } },
        });
        for (const admin of admins.filter((member) => member.user.isActive)) {
          await queueEmail(container, {
            to: admin.user.email,
            template: 'usageLimit',
            email: emailTemplates.usageLimit({
              companyName: company.name,
              metricLabel: metric.label,
              usage,
              percent: threshold,
              url: `${container.env.APP_URL}/app/settings/billing`,
            }),
          });
        }
      }
    }
  }
  return { companies: companies.length, created };
}
