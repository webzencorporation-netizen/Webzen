import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { ObjectStorageProvider, PutObjectOptions } from './types';

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/** S3 e compatíveis (Cloudflare R2, MinIO...). Objetos privados; acesso sempre via API autenticada. */
export class S3ObjectStorage implements ObjectStorageProvider {
  readonly name = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region ?? 'auto',
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
      // Desde o SDK 3.729, checksums CRC são enviados por padrão e recusados por R2 e
      // MinIO/Ceph antigos. No AWS S3 (sem endpoint), mantém as proteções padrão.
      ...(config.endpoint
        ? {
            requestChecksumCalculation: 'WHEN_REQUIRED' as const,
            responseChecksumValidation: 'WHEN_REQUIRED' as const,
          }
        : {}),
    });
  }

  async put(key: string, data: Buffer, options?: PutObjectOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data, ContentType: options?.contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!response.Body) throw new Error(`Objeto vazio: ${key}`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return false;
      throw error;
    }
  }
}
