import fs from 'node:fs/promises';
import path from 'node:path';
import type { ObjectStorageProvider, PutObjectOptions } from './types';

/** Armazenamento em disco — somente desenvolvimento. */
export class LocalObjectStorage implements ObjectStorageProvider {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('Caminho fora do diretório de armazenamento.');
    return target;
  }

  async put(key: string, data: Buffer, _options?: PutObjectOptions): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
