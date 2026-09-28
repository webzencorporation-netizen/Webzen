import type { ObjectStorageProvider } from './types';

/** Armazenamento em memória para testes. */
export class MemoryObjectStorage implements ObjectStorageProvider {
  readonly name = 'memory' as const;
  readonly objects = new Map<string, { data: Buffer; contentType?: string }>();

  async put(key: string, data: Buffer, options?: { contentType?: string }): Promise<void> {
    this.objects.set(key, { data, contentType: options?.contentType });
  }

  async get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Objeto não encontrado: ${key}`);
    return object.data;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}
