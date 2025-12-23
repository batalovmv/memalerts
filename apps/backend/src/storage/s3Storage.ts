import fs from 'fs';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { StorageProvider, StoreFromTempArgs, StoredObject } from './types.js';

type S3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  keyPrefix: string;
  forcePathStyle: boolean;
};

function safeJoinUrl(base: string, pathPart: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = pathPart.startsWith('/') ? pathPart.slice(1) : pathPart;
  return `${b}/${p}`;
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore
  }
}

export class S3StorageProvider implements StorageProvider {
  kind: 's3' = 's3';
  private readonly cfg: S3Config;
  private readonly client: S3Client;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  private makeKey(hash: string, extWithDot: string): string {
    const prefix = this.cfg.keyPrefix ? this.cfg.keyPrefix.replace(/\/+$/, '') + '/' : '';
    return `${prefix}memes/${hash}${extWithDot}`;
  }

  async storeMemeFromTemp(args: StoreFromTempArgs): Promise<StoredObject> {
    const key = this.makeKey(args.hash, args.extWithDot);
    const body = fs.createReadStream(args.tempFilePath);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: args.mimeType || undefined,
        // These files are content-addressed (hash in name) → safe to cache “forever”.
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );

    // Delete temp file after upload.
    await safeUnlink(args.tempFilePath);

    const publicPath = safeJoinUrl(this.cfg.publicBaseUrl, key);
    return { publicPath, key };
  }

  async deleteByPublicPath(publicPath: string): Promise<void> {
    // Best-effort delete:
    // - If publicPath matches publicBaseUrl, strip it to get key
    // - Otherwise ignore (might be local path or unknown)
    const p = String(publicPath || '').trim();
    if (!p) return;

    let key: string | null = null;
    const base = this.cfg.publicBaseUrl.endsWith('/') ? this.cfg.publicBaseUrl : `${this.cfg.publicBaseUrl}/`;
    if (p.startsWith(base)) {
      key = p.slice(base.length);
    } else {
      // Try URL parsing (handles missing trailing slash edge cases)
      try {
        const u = new URL(p);
        const b = new URL(this.cfg.publicBaseUrl);
        if (u.host === b.host) {
          const prefixPath = b.pathname.endsWith('/') ? b.pathname : `${b.pathname}/`;
          const uPath = u.pathname.startsWith('/') ? u.pathname : `/${u.pathname}`;
          if (uPath.startsWith(prefixPath)) {
            key = uPath.slice(prefixPath.length);
          }
        }
      } catch {
        // ignore
      }
    }

    if (!key) return;

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.cfg.bucket,
          Key: key,
        })
      );
    } catch {
      // ignore
    }
  }
}

export function loadS3ConfigFromEnv(): S3Config | null {
  const bucket = String(process.env.S3_BUCKET || '').trim();
  const accessKeyId = String(process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.S3_SECRET_ACCESS_KEY || '').trim();
  const publicBaseUrl = String(process.env.S3_PUBLIC_BASE_URL || '').trim();

  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) return null;

  const endpoint = String(process.env.S3_ENDPOINT || '').trim() || undefined;
  const region = String(process.env.S3_REGION || '').trim() || 'auto';
  const keyPrefix = String(process.env.S3_KEY_PREFIX || '').trim();
  const forcePathStyle =
    String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === '1' ||
    String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true' ||
    !!endpoint; // custom endpoints (R2/MinIO) often require path-style

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    keyPrefix,
    forcePathStyle,
  };
}


