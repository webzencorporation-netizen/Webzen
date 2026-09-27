import { isNotFoundError, isUniqueConstraintError, TenantScopeViolation } from '@botsaas/database';
import { AppError, ERROR_CODES, type ApiErrorBody } from '@botsaas/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  body: Omit<ApiErrorBody['error'], 'requestId'>,
) {
  const payload: ApiErrorBody = { error: { ...body, requestId: request.id } };
  return reply.status(status).send(payload);
}

/**
 * Tratamento centralizado: erros viram `{ error: { code, message, details?, requestId } }`.
 * Nunca expõe stack trace nem mensagens internas; o detalhe vai para o log com requestId.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return send(reply, request, 400, {
        code: ERROR_CODES.VALIDATION,
        message: 'Dados inválidos.',
        details: error.validation.map((issue) => ({
          path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: issue.message,
        })),
      });
    }
    if (error instanceof ZodError) {
      return send(reply, request, 400, {
        code: ERROR_CODES.VALIDATION,
        message: 'Dados inválidos.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    if (error instanceof AppError) {
      if (error.httpStatus >= 500) request.log.error({ err: error }, error.message);
      else request.log.info({ code: error.code }, error.message);
      return send(reply, request, error.httpStatus, {
        code: error.code,
        message: error.message,
        ...(error.httpStatus < 500 && error.details !== undefined
          ? { details: error.details }
          : {}),
      });
    }
    if (error instanceof TenantScopeViolation) {
      request.log.warn(
        { err: error, userId: request.auth?.user.id },
        'Violação de escopo de empresa bloqueada',
      );
      return send(reply, request, 404, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Registro não encontrado.',
      });
    }
    if (isNotFoundError(error)) {
      return send(reply, request, 404, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Registro não encontrado.',
      });
    }
    if (isUniqueConstraintError(error)) {
      return send(reply, request, 409, {
        code: ERROR_CODES.CONFLICT,
        message: 'Já existe um registro com esses dados.',
      });
    }
    const status =
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status === 429) {
      return send(reply, request, 429, {
        code: ERROR_CODES.RATE_LIMIT,
        message: 'Muitas requisições. Tente novamente em instantes.',
      });
    }
    if (status >= 400 && status < 500) {
      return send(reply, request, status, {
        code:
          status === 401
            ? ERROR_CODES.AUTHENTICATION
            : status === 403
              ? ERROR_CODES.AUTHORIZATION
              : ERROR_CODES.VALIDATION,
        message: status === 413 ? 'Arquivo ou requisição muito grande.' : 'Requisição inválida.',
      });
    }
    request.log.error({ err: error }, 'Erro não tratado');
    return send(reply, request, 500, {
      code: ERROR_CODES.INTERNAL,
      message: 'Erro interno. Tente novamente.',
    });
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Rota não encontrada.' }),
  );
}
