/**
 * object-store.ts — MinIO / S3-compatible object storage client
 *
 * Wraps @aws-sdk/client-s3 configured for MinIO endpoint.
 * Auto-creates the configured bucket on first init if it does not exist.
 *
 * Env vars (see .env.example):
 *   MINIO_ENDPOINT        — e.g. http://localhost:9000
 *   MINIO_ACCESS_KEY      — MinIO root user
 *   MINIO_SECRET_KEY      — MinIO root password (CHANGE_ME_BEFORE_BOOT rejected at boot)
 *   MINIO_BUCKET          — bucket name, default "wiki-team-files"
 *   MINIO_FORCE_PATH_STYLE — "true" for MinIO/local, "false" for AWS S3
 */

import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ---------------------------------------------------------------------------
// assertEnv — shared guard (mirrors db.ts; no shared util to avoid import cycle)

function assertEnv(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`[object-store] Required env var ${key} is missing or empty.`);
  }
  if (value.includes('CHANGE_ME_BEFORE_BOOT')) {
    throw new Error(
      `[object-store] Env var ${key} still contains placeholder "CHANGE_ME_BEFORE_BOOT". ` +
      'Set a real MinIO secret before starting the server.',
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// ObjectStore — S3/MinIO client wrapper

export interface UploadOptions {
  /** MIME type of the object */
  contentType: string;
  /** Additional metadata key-value pairs */
  metadata?: Record<string, string>;
}

export interface ObjectMeta {
  key: string;
  sizeBytes: number;
  contentType: string | undefined;
  lastModified: Date | undefined;
}

export class ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private initialised = false;

  constructor() {
    const endpoint  = assertEnv('MINIO_ENDPOINT',   process.env['MINIO_ENDPOINT']);
    const accessKey = assertEnv('MINIO_ACCESS_KEY', process.env['MINIO_ACCESS_KEY']);
    const secretKey = assertEnv('MINIO_SECRET_KEY', process.env['MINIO_SECRET_KEY']);
    const forcePathStyle = process.env['MINIO_FORCE_PATH_STYLE'] !== 'false';

    this.bucket = process.env['MINIO_BUCKET'] ?? 'wiki-team-files';

    this.client = new S3Client({
      endpoint,
      region: 'us-east-1',           // MinIO ignores region but SDK requires it
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle,                 // required for MinIO; false for real AWS S3
    });
  }

  /**
   * Ensure the configured bucket exists, creating it if absent.
   * Idempotent — safe to call on every app start.
   */
  async init(): Promise<void> {
    if (this.initialised) return;

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'NotFound' || code === 'NoSuchBucket') {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } else {
        throw err;
      }
    }

    this.initialised = true;
  }

  /**
   * Upload a file buffer to object storage.
   * @param key    — storage key (e.g. "materials/<uuid>/<filename>")
   * @param body   — file contents as Buffer or Uint8Array
   * @param opts   — contentType and optional metadata
   */
  async upload(key: string, body: Buffer | Uint8Array, opts: UploadOptions): Promise<void> {
    await this.ensureInit();
    const input: PutObjectCommandInput = {
      Bucket:      this.bucket,
      Key:         key,
      Body:        body,
      ContentType: opts.contentType,
      Metadata:    opts.metadata,
    };
    await this.client.send(new PutObjectCommand(input));
  }

  /**
   * Download an object as a Buffer.
   * Throws if key does not exist.
   */
  async download(key: string): Promise<Buffer> {
    await this.ensureInit();
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error(`[object-store] Empty body for key: ${key}`);
    }

    // Collect streaming body into a Buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Get metadata for an object without downloading its body.
   * Throws if key does not exist.
   */
  async stat(key: string): Promise<ObjectMeta> {
    await this.ensureInit();
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      key,
      sizeBytes:    response.ContentLength ?? 0,
      contentType:  response.ContentType,
      lastModified: response.LastModified,
    };
  }

  /**
   * Delete an object. No-op if key does not exist.
   */
  async delete(key: string): Promise<void> {
    await this.ensureInit();
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Generate a pre-signed GET URL (default TTL: 1 hour).
   * Use for temporary direct-download links without exposing credentials.
   */
  async presignedGetUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    await this.ensureInit();
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialised) await this.init();
  }
}

// ---------------------------------------------------------------------------
// Singleton export

let _store: ObjectStore | null = null;

export function getObjectStore(): ObjectStore {
  if (!_store) _store = new ObjectStore();
  return _store;
}
