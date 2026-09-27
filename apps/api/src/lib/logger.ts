import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Logs estruturados. Campos sensíveis são removidos antes de qualquer saída.
 * Sempre que possível inclua requestId, companyId, conversationId e jobId via child loggers.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.access_token',
  '*.refreshToken',
  '*.refresh_token',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.clientSecret',
  '*.credentials',
  '*.credentialsEncrypted',
  '*.accessTokenEncrypted',
  'headers.authorization',
  'headers["x-hub-signature-256"]',
];

export function createLoggerOptions(level: string, pretty: boolean): LoggerOptions {
  return {
    level,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
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
