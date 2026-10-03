import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLoggerOptions } from '../src/lib/logger';

/** Segredos nunca chegam à saída do log, em qualquer profundidade usual de objeto. */

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino(createLoggerOptions('trace', false), stream);
  return { logger, output: () => lines.join('') };
}

const SECRET = 'segredo-super-sensivel-123';

describe('redação de logs', () => {
  it('remove segredos no topo, aninhados e em cabeçalhos', () => {
    const { logger, output } = capture();
    logger.info({ password: SECRET }, 'topo');
    logger.info({ user: { password: SECRET } }, 'um nível');
    logger.info({ a: { b: { token: SECRET } } }, 'dois níveis');
    logger.info({ a: { b: { c: { apiKey: SECRET } } } }, 'três níveis');
    logger.info({ headers: { authorization: `Bearer ${SECRET}`, cookie: `sid=${SECRET}` } }, 'h');
    logger.info({ req: { headers: { Authorization: `Bearer ${SECRET}` } } }, 'req');
    logger.info({ body: { accessToken: SECRET, access_token: SECRET, secret: SECRET } }, 'body');
    logger.info({ credentials: { accessToken: SECRET } }, 'credenciais');
    logger.info({ META_MODEL_API_KEY: SECRET, ANTHROPIC_API_KEY: SECRET }, 'env');
    const error = Object.assign(new Error('falha'), {
      config: { headers: { Authorization: `Bearer ${SECRET}` } },
      request: { headers: { 'x-api-key': SECRET } },
    });
    logger.error({ err: error }, 'erro com cabeçalhos');

    const text = output();
    expect(text).not.toContain(SECRET);
    expect(text.match(/\[REDACTED\]/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
    // O restante do contexto continua útil.
    expect(text).toContain('erro com cabeçalhos');
    expect(text).toContain('falha');
  });
});
