import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalObjectStorage } from '../src/storage/local';
import { MemoryObjectStorage } from '../src/storage/memory';
import { assertKeyBelongsToCompany, buildObjectKey } from '../src/storage/types';
import type { ObjectStorageProvider } from '../src/storage/types';

describe.each(['local', 'memory'] as const)('storage %s', (kind) => {
  let directory: string;
  let storage: ObjectStorageProvider;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botsaas-storage-test-'));
    storage = kind === 'local' ? new LocalObjectStorage(directory) : new MemoryObjectStorage();
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('preserva bytes, sobrescreve objetos e mantém chaves de empresas distintas', async () => {
    const key = buildObjectKey('company-a', 'media', 'audio.ogg');
    const otherKey = buildObjectKey('company-b', 'media', 'audio.ogg');
    const bytes = Buffer.from([0, 255, 42, 10]);
    expect(await storage.exists(key)).toBe(false);
    await storage.put(key, bytes, { contentType: 'audio/ogg' });
    await storage.put(otherKey, Buffer.from('outra empresa'));
    expect(await storage.get(key)).toEqual(bytes);
    expect(await storage.exists(key)).toBe(true);
    await storage.put(key, Buffer.from('novo conteúdo'));
    expect((await storage.get(key)).toString()).toBe('novo conteúdo');
    expect((await storage.get(otherKey)).toString()).toBe('outra empresa');
  });

  it('remove apenas o objeto solicitado, tolera repetição e recusa leitura ausente', async () => {
    await storage.put('companies/a/remove', Buffer.from('remover'));
    await storage.put('companies/a/keep', Buffer.from('manter'));
    await storage.delete('companies/a/remove');
    await storage.delete('companies/a/remove');
    expect(await storage.exists('companies/a/remove')).toBe(false);
    await expect(storage.get('companies/a/remove')).rejects.toThrow();
    expect((await storage.get('companies/a/keep')).toString()).toBe('manter');
  });
});

describe('contenção de caminhos locais', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botsaas-path-test-'));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each(['../outside', '../objects-sibling/outside', '/tmp/outside', '.', ''])(
    'recusa operações fora da raiz ou na própria raiz: %j',
    async (key) => {
      const storage = new LocalObjectStorage(path.join(directory, 'objects'));
      const sentinel = path.join(directory, 'outside');
      await fs.writeFile(sentinel, 'não modificar');
      await expect(storage.put(key, Buffer.from('alterado'))).rejects.toThrow('Caminho fora');
      await expect(Promise.resolve().then(() => storage.get(key))).rejects.toThrow('Caminho fora');
      await expect(storage.delete(key)).rejects.toThrow('Caminho fora');
      expect(await storage.exists(key)).toBe(false);
      expect(await fs.readFile(sentinel, 'utf8')).toBe('não modificar');
    },
  );
});

describe('chaves com prefixo de empresa', () => {
  it('usa ano e mês UTC na virada local de ano', () => {
    expect(
      buildObjectKey(
        'company-a',
        'knowledge',
        'manual_v2.pdf',
        new Date('2025-12-31T23:30:00-03:00'),
      ),
    ).toBe('companies/company-a/knowledge/2026/01/manual_v2.pdf');
  });

  it.each(['', '.', '..', '../other', '/absolute', 'a/b', 'a\\b', 'a%2fb', 'a\u0000b'])(
    'recusa segmento inseguro em qualquer parte variável: %j',
    (segment) => {
      expect(() => buildObjectKey(segment, 'media', 'file')).toThrow('Segmento');
      expect(() => buildObjectKey('company-a', segment, 'file')).toThrow('Segmento');
      expect(() => buildObjectKey('company-a', 'media', segment)).toThrow('Segmento');
    },
  );

  it('valida fronteira do prefixo e recusa travessia entre empresas', () => {
    const key = buildObjectKey('company-a', 'media', 'audio.ogg');
    expect(() => assertKeyBelongsToCompany(key, 'company-a')).not.toThrow();
    for (const invalid of [
      key.replace('company-a', 'company-ab'),
      'companies/company-a',
      'companies/company-a/../company-b/file',
      '/companies/company-a/file',
    ]) {
      expect(() => assertKeyBelongsToCompany(invalid, 'company-a')).toThrow('não pertence');
    }
  });
});
