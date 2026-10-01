import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * POST para URLs informadas pelo cliente (webhooks de saída), com proteção contra SSRF:
 * - só http(s), sem credenciais na URL, porta padrão ou 1024+;
 * - o IP é validado DENTRO do `lookup` da conexão (o que foi checado é o que se conecta:
 *   não há janela para DNS rebinding);
 * - redes privadas, loopback, link-local (inclui 169.254.169.254, metadados de nuvem),
 *   CGNAT, multicast e reservados são recusados, salvo `allowPrivateNetworks` (desenvolvimento);
 * - sem seguir redirecionamentos, com timeout total e resposta lida até 4 KB.
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export function isBlockedAddress(address: string): boolean {
  // IPv4 mapeado em IPv6 (::ffff:a.b.c.d) vale como o IPv4 embutido. Não usar uma regra
  // `::ffff:0:0/96` no BlockList: o Node compara IPv4 contra ela e bloquearia todo IPv4.
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  const candidate = mapped?.[1] ?? address;
  const family = isIP(candidate);
  if (family === 0) return true;
  return BLOCKED.check(candidate, family === 4 ? 'ipv4' : 'ipv6');
}

export interface SafeUrlOptions {
  allowPrivateNetworks: boolean;
  requireHttps: boolean;
}

/** Validação estática (formato). A validação de IP acontece na conexão. */
export function assertSafeUrl(raw: string, options: SafeUrlOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('URL inválida.');
  }
  if (url.protocol !== 'https:' && (options.requireHttps || url.protocol !== 'http:')) {
    throw new UnsafeUrlError(
      options.requireHttps ? 'Use uma URL https://.' : 'Use http:// ou https://.',
    );
  }
  if (url.username || url.password)
    throw new UnsafeUrlError('A URL não pode conter usuário ou senha.');
  const port = url.port ? Number(url.port) : null;
  if (port !== null && port < 1024 && port !== 80 && port !== 443) {
    throw new UnsafeUrlError('Porta não permitida.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!options.allowPrivateNetworks) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
      throw new UnsafeUrlError('Endereço interno não permitido.');
    }
    if (isIP(host) && isBlockedAddress(host))
      throw new UnsafeUrlError('Endereço interno não permitido.');
  }
  return url;
}

type Resolver = (
  hostname: string,
  options: { all: true; family?: number },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/** `lookup` usado na conexão: filtra endereços internos depois da resolução. Exportado para testes. */
export function createGuardedLookup(
  allowPrivate: boolean,
  resolver: Resolver = dnsLookup as unknown as Resolver,
): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname, { ...(options as { family?: number }), all: true }, (error, addresses) => {
      if (error) return callback(error, '', 4);
      const list = (Array.isArray(addresses) ? addresses : [addresses]) as LookupAddress[];
      const safe = allowPrivate ? list : list.filter((entry) => !isBlockedAddress(entry.address));
      if (safe.length === 0) {
        return callback(new UnsafeUrlError('O destino resolve para um endereço interno.'), '', 4);
      }
      if ((options as { all?: boolean }).all) return callback(null, safe as never, 4);
      const first = safe[0]!;
      return callback(null, first.address, first.family);
    });
  };
}

export interface SafePostResult {
  status: number;
  body: string;
}

export async function safePost(
  raw: string,
  body: string,
  headers: Record<string, string>,
  options: SafeUrlOptions & { timeoutMs?: number },
): Promise<SafePostResult> {
  const url = assertSafeUrl(raw, options);
  const transport = url.protocol === 'https:' ? https : http;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
        lookup: createGuardedLookup(options.allowPrivateNetworks),
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          if (size < 4096) chunks.push(chunk);
          size += chunk.length;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 4096),
          }),
        );
        response.on('error', reject);
      },
    );
    const deadline = setTimeout(
      () => request.destroy(new Error(`Tempo esgotado (${timeoutMs} ms).`)),
      timeoutMs,
    );
    request.on('timeout', () => request.destroy(new Error(`Tempo esgotado (${timeoutMs} ms).`)));
    request.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.on('close', () => clearTimeout(deadline));
    request.end(body);
  });
}
