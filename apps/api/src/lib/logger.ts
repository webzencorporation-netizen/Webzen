import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Logs estruturados. Campos sensíveis são removidos antes de qualquer saída.
 * Sempre que possível inclua requestId, companyId, conversationId e jobId via child loggers.
 */
/** Campos sensíveis (nome exato da chave), removidos em qualquer profundidade até `REDACT_DEPTH`. */
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'tokenHash',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authToken',
  'apiKey',
  'api_key',
  'secret',
  'clientSecret',
  'client_secret',
  'credentials',
  'credentialsEncrypted',
  'accessTokenEncrypted',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'x-api-key',
  'x-hub-signature-256',
  'ANTHROPIC_API_KEY',
  'META_MODEL_API_KEY',
  'STT_API_KEY',
  'S3_SECRET_ACCESS_KEY',
  'WHATSAPP_APP_SECRET',
  'ENCRYPTION_KEY',
  'GOOGLE_CLIENT_SECRET',
  'DATABASE_URL',
];

const SENSITIVE = new Set(SENSITIVE_KEYS.map((key) => key.toLowerCase()));
const CENSOR = '[REDACTED]';
const MAX_DEPTH = 8;

/**
 * Remove campos sensíveis em qualquer profundidade (inclusive dentro de erros), copiando só
 * os ramos alterados. O `redact` do pino só aceita curinga de um nível e, com caminhos para
 * vários níveis, ficava ~100x mais lento por linha de log.
 */
export function redactSecrets(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    value.forEach((item, index) => {
      const next = redactSecrets(item, depth + 1, seen);
      if (next !== item) (copy ??= [...value])[index] = next;
    });
    return copy ?? value;
  }
  const source = value as Record<string, unknown>;
  const keys =
    value instanceof Error
      ? ['name', 'message', 'stack', ...Object.keys(source)]
      : Object.keys(source);
  let copy: Record<string, unknown> | undefined;
  for (const key of keys) {
    const current = source[key];
    const next = SENSITIVE.has(key.toLowerCase())
      ? current === undefined || current === null
        ? current
        : CENSOR
      : redactSecrets(current, depth + 1, seen);
    if (next !== current) {
      copy ??=
        value instanceof Error ? { type: value.name, ...pickErrorFields(value) } : { ...source };
      copy[key] = next;
    }
  }
  return copy ?? value;
}

function pickErrorFields(error: Error): Record<string, unknown> {
  return {
    message: error.message,
    stack: error.stack,
    ...(error as unknown as Record<string, unknown>),
  };
}

export function createLoggerOptions(level: string, pretty: boolean): LoggerOptions {
  return {
    level,
    // Cabeçalhos da requisição/resposta HTTP (serializados pelo pino) + qualquer campo sensível.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: CENSOR,
    },
    formatters: { log: (object) => redactSecrets(object) as Record<string, unknown> },
    base: { service: process.env.SERVICE_NAME ?? 'botsaas-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {}),
  };
}

export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  const pretty = process.env.NODE_ENV === 'development' && process.stdout.isTTY === true;
  return pino(createLoggerOptions(level, pretty));
}

export type { Logger };
