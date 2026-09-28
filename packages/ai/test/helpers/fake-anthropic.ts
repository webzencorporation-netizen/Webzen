import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Servidor HTTP local que responde no formato da API da Anthropic, para exercitar o SDK
 * real sem rede externa nem credenciais. Respostas são consumidas em ordem.
 */

export interface CapturedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export interface FakeReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface FakeAnthropic {
  baseURL: string;
  captured: CapturedRequest[];
  replies: FakeReply[];
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeAnthropic(): Promise<FakeAnthropic> {
  const captured: CapturedRequest[] = [];
  const replies: FakeReply[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      captured.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      const reply = replies.shift() ?? {
        status: 500,
        body: { type: 'error', error: { type: 'api_error', message: 'sem resposta' } },
      };
      res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    captured,
    replies,
    reset() {
      captured.length = 0;
      replies.length = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function usage(input: number, output: number, extra: Record<string, unknown> = {}) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ...extra,
  };
}

export function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: usage(120, 30),
    ...overrides,
  };
}

export function modelInfo(id: string) {
  return {
    type: 'model',
    id,
    display_name: id,
    created_at: '2026-01-01T00:00:00Z',
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
  };
}
