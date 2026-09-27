import { systemDb, type ErrorSource, type Prisma } from '@botsaas/database';

/** Registro de erros operacionais exibidos na área da plataforma ("Erros recentes"). */
export async function recordError(input: {
  source: ErrorSource;
  code: string;
  message: string;
  companyId?: string | null;
  conversationId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  context?: Record<string, unknown>;
}): Promise<void> {
  await systemDb.errorLog
    .create({
      data: {
        source: input.source,
        code: input.code.slice(0, 100),
        message: input.message.slice(0, 1000),
        companyId: input.companyId ?? null,
        conversationId: input.conversationId ?? null,
        requestId: input.requestId ?? null,
        jobId: input.jobId ?? null,
        context: (input.context ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    .catch(() => undefined);
}
