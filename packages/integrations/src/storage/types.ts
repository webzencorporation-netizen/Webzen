export interface PutObjectOptions {
  contentType?: string;
}

/** Armazenamento de objetos (mídias, documentos). Chaves sempre prefixadas por empresa. */
export interface ObjectStorageProvider {
  readonly name: 'local' | 's3' | 'memory';
  put(key: string, data: Buffer, options?: PutObjectOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** Monta chave `companies/<companyId>/<area>/<yyyy>/<mm>/<fileName>` validando cada segmento. */
export function buildObjectKey(companyId: string, area: string, fileName: string, now = new Date()): string {
  const segments = [
    'companies',
    companyId,
    area,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    fileName,
  ];
  for (const segment of segments) {
    if (!SAFE_SEGMENT.test(segment) || segment === '.' || segment === '..') {
      throw new Error(`Segmento de chave inválido: ${segment}`);
    }
  }
  return segments.join('/');
}

/** Garante que uma chave pertence à empresa (defesa em profundidade contra IDOR). */
export function assertKeyBelongsToCompany(key: string, companyId: string): void {
  if (!key.startsWith(`companies/${companyId}/`) || key.includes('..')) {
    throw new Error('Chave de objeto não pertence à empresa.');
  }
}
