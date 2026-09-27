/**
 * Erros de domínio classificados. A API converte qualquer erro em resposta
 * padronizada `{ error: { code, message, details?, requestId } }` sem stack trace.
 */

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  AUTHENTICATION: 'AUTHENTICATION_ERROR',
  AUTHORIZATION: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTEGRATION: 'INTEGRATION_ERROR',
  AI_PROVIDER: 'AI_PROVIDER_ERROR',
  WHATSAPP: 'WHATSAPP_ERROR',
  RATE_LIMIT: 'RATE_LIMIT_ERROR',
  LIMIT_REACHED: 'LIMIT_REACHED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
  /** Se verdadeiro, a operação pode ser repetida (útil para jobs). */
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: ErrorCode, httpStatus: number, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dados inválidos.', options?: AppErrorOptions) {
    super(ERROR_CODES.VALIDATION, 400, message, options);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Autenticação necessária.', options?: AppErrorOptions) {
    super(ERROR_CODES.AUTHENTICATION, 401, message, options);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Você não tem permissão para esta ação.', options?: AppErrorOptions) {
    super(ERROR_CODES.AUTHORIZATION, 403, message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Registro não encontrado.', options?: AppErrorOptions) {
    super(ERROR_CODES.NOT_FOUND, 404, message, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflito com o estado atual.', options?: AppErrorOptions) {
    super(ERROR_CODES.CONFLICT, 409, message, options);
  }
}

export class IntegrationError extends AppError {
  constructor(message = 'Falha em integração externa.', options?: AppErrorOptions) {
    super(ERROR_CODES.INTEGRATION, 502, message, options);
  }
}

export class AIProviderError extends AppError {
  constructor(message = 'Falha no provedor de IA.', options?: AppErrorOptions) {
    super(ERROR_CODES.AI_PROVIDER, 502, message, options);
  }
}

export class WhatsAppError extends AppError {
  constructor(message = 'Falha na API do WhatsApp.', options?: AppErrorOptions) {
    super(ERROR_CODES.WHATSAPP, 502, message, options);
  }
}

export class RateLimitError extends AppError {
  constructor(
    message = 'Muitas requisições. Tente novamente em instantes.',
    options?: AppErrorOptions,
  ) {
    super(ERROR_CODES.RATE_LIMIT, 429, message, { retryable: true, ...options });
  }
}

export class LimitReachedError extends AppError {
  constructor(message = 'Limite do plano atingido.', options?: AppErrorOptions) {
    super(ERROR_CODES.LIMIT_REACHED, 402, message, options);
  }
}

export class FeatureDisabledError extends AppError {
  constructor(message = 'Recurso não disponível no plano atual.', options?: AppErrorOptions) {
    super(ERROR_CODES.FEATURE_DISABLED, 403, message, options);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Erro interno.', options?: AppErrorOptions) {
    super(ERROR_CODES.INTERNAL, 500, message, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Formato de erro retornado pela API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
