import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type * as S3Sdk from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3ObjectStorage } from '../src/storage/s3';
import { buildObjectKey } from '../src/storage/types';

const { send } = vi.hoisted(() => ({ send: vi.fn<(command: unknown) => Promise<unknown>>() }));

// Preserva os comandos reais, mas nunca constrói cliente, transporte ou cadeia de credenciais AWS.
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const original = await importOriginal<typeof S3Sdk>();
  return {
    ...original,
    S3Client: vi.fn(
      class {
        send = send;
      },
    ),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  send.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Rede real proibida neste teste');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const key = buildObjectKey('company-a', 'media', 'voice.ogg', new Date('2026-01-01T00:00:00Z'));
const bucket = 'fixture-private-bucket';
const notFound = () =>
  new NotFound({ message: 'fixture missing object', $metadata: { httpStatusCode: 404 } });

describe('configuração do cliente S3', () => {
  it('encaminha endpoint compatível, região, path-style, credenciais e checksums compatíveis', () => {
    new S3ObjectStorage({
      bucket,
      region: 'fixture-region',
      endpoint: 'https://s3.invalid',
      forcePathStyle: true,
      accessKeyId: 'fixture-access',
      secretAccessKey: 'fixture-secret',
    });
    expect(S3Client).toHaveBeenCalledExactlyOnceWith({
      region: 'fixture-region',
      endpoint: 'https://s3.invalid',
      forcePathStyle: true,
      credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
      // R2 e MinIO/Ceph antigos recusam os checksums CRC enviados por padrão desde o SDK 3.729.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    expect(send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sem endpoint (AWS S3): região auto, credenciais delegadas ao SDK e checksums padrão', () => {
    new S3ObjectStorage({ bucket });
    expect(S3Client).toHaveBeenCalledExactlyOnceWith({
      region: 'auto',
      endpoint: undefined,
      forcePathStyle: undefined,
      credentials: undefined,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('comandos S3 e conteúdo dos objetos', () => {
  it('faz roundtrip binário, sobrescreve, mantém prefixos distintos e remove idempotentemente', async () => {
    const objects = new Map<string, { bytes: Buffer; contentType?: string }>();
    send.mockImplementation(async (command) => {
      if (!(
        command instanceof PutObjectCommand ||
        command instanceof GetObjectCommand ||
        command instanceof HeadObjectCommand ||
        command instanceof DeleteObjectCommand
      ))
        throw new Error('Comando inesperado');
      expect(command.input.Bucket).toBe(bucket);
      const objectKey = command.input.Key!;
      if (command instanceof PutObjectCommand) {
        objects.set(objectKey, {
          bytes: Buffer.from(command.input.Body as Buffer),
          contentType: command.input.ContentType,
        });
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(objectKey);
        return {};
      }
      const object = objects.get(objectKey);
      if (!object) throw notFound();
      if (command instanceof HeadObjectCommand) return {};
      return { Body: { transformToByteArray: async () => Uint8Array.from(object.bytes) } };
    });
    const storage = new S3ObjectStorage({ bucket });
    const otherKey = key.replace('company-a', 'company-b');
    const bytes = Buffer.from([0, 255, 42, 10]);
    await expect(storage.exists(key)).resolves.toBe(false);
    await storage.put(key, bytes, { contentType: 'audio/ogg' });
    await storage.put(otherKey, Buffer.from('outra empresa'));
    expect(objects.get(key)?.contentType).toBe('audio/ogg');
    await expect(storage.get(key)).resolves.toEqual(bytes);
    await expect(storage.exists(key)).resolves.toBe(true);
    await storage.put(key, Buffer.from('substituído'));
    await expect(storage.get(key)).resolves.toEqual(Buffer.from('substituído'));
    await storage.delete(key);
    await storage.delete(key);
    await expect(storage.exists(key)).resolves.toBe(false);
    await expect(storage.get(key)).rejects.toBeInstanceOf(NotFound);
    await expect(storage.get(otherKey)).resolves.toEqual(Buffer.from('outra empresa'));
  });

  it('envia bytes e ContentType com bucket e chave exatos, sem tornar o objeto público', async () => {
    send.mockResolvedValue({});
    const storage = new S3ObjectStorage({ bucket });
    const data = Buffer.from('documento');
    await storage.put(key, data, { contentType: 'application/pdf' });
    const command = send.mock.calls[0]![0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: 'application/pdf',
    });
    expect(command.input.ACL).toBeUndefined();
  });

  it('aceita objeto de zero bytes e transforma o corpo SDK em Buffer', async () => {
    const transformToByteArray = vi.fn(async () => new Uint8Array());
    send.mockResolvedValue({ Body: { transformToByteArray } });
    const result = await new S3ObjectStorage({ bucket }).get(key);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(0);
    expect(transformToByteArray).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]![0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: bucket, Key: key });
  });

  it('recusa resposta sem corpo em vez de produzir arquivo vazio', async () => {
    send.mockResolvedValue({});
    await expect(new S3ObjectStorage({ bucket }).get(key)).rejects.toThrow('Objeto vazio');
  });

  it('propaga falha de leitura do stream sem produzir conteúdo parcial', async () => {
    const failure = new Error('fixture stream interrupted');
    send.mockResolvedValue({
      Body: {
        transformToByteArray: async () => {
          throw failure;
        },
      },
    });
    await expect(new S3ObjectStorage({ bucket }).get(key)).rejects.toBe(failure);
  });

  it('DELETE usa o bucket e a chave exatos', async () => {
    send.mockResolvedValue({});
    await new S3ObjectStorage({ bucket }).delete(key);
    const command = send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: bucket, Key: key });
  });

  it.each(['put', 'get', 'delete'] as const)(
    'propaga erro do SDK em %s sem reinterpretar o resultado',
    async (operation) => {
      const failure = new S3ServiceException({
        name: 'AccessDenied',
        message: 'fixture access denied',
        $fault: 'client',
        $metadata: { httpStatusCode: 403 },
      });
      send.mockRejectedValue(failure);
      const storage = new S3ObjectStorage({ bucket });
      const operations = {
        put: () => storage.put(key, Buffer.from('data')),
        get: () => storage.get(key),
        delete: () => storage.delete(key),
      };
      await expect(operations[operation]()).rejects.toBe(failure);
      expect(send).toHaveBeenCalledOnce();
    },
  );
});

describe('existência no S3', () => {
  it('HEAD bem-sucedido retorna true sem baixar o objeto', async () => {
    send.mockResolvedValue({ ContentLength: 100 });
    await expect(new S3ObjectStorage({ bucket }).exists(key)).resolves.toBe(true);
    const command = send.mock.calls[0]![0] as HeadObjectCommand;
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toEqual({ Bucket: bucket, Key: key });
    expect(send).toHaveBeenCalledOnce();
  });

  it('NotFound404 retorna false', async () => {
    send.mockRejectedValue(notFound());
    await expect(new S3ObjectStorage({ bucket }).exists(key)).resolves.toBe(false);
  });

  it.each([403, 429, 500, 503])('HTTP %i não é confundido com objeto ausente', async (status) => {
    const failure = new S3ServiceException({
      name: 'FixtureFailure',
      message: 'fixture failure',
      $fault: status >= 500 ? 'server' : 'client',
      $metadata: { httpStatusCode: status },
    });
    send.mockRejectedValue(failure);
    await expect(new S3ObjectStorage({ bucket }).exists(key)).rejects.toBe(failure);
  });

  it('falha de rede não é confundida com objeto ausente', async () => {
    const failure = Object.assign(new Error('fixture connection reset'), { code: 'ECONNRESET' });
    send.mockRejectedValue(failure);
    await expect(new S3ObjectStorage({ bucket }).exists(key)).rejects.toBe(failure);
  });
});
