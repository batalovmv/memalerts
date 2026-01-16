import type { StorageProvider } from './types.js';
import { LocalStorageProvider } from './localStorage.js';
import { S3StorageProvider, loadS3ConfigFromEnv } from './s3Storage.js';

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;

  const kind = String(process.env.UPLOAD_STORAGE || '')
    .trim()
    .toLowerCase();
  if (kind === 's3') {
    const cfg = loadS3ConfigFromEnv();
    if (cfg) {
      provider = new S3StorageProvider(cfg);
      return provider;
    }
    // Misconfigured S3 → fall back to local to avoid breaking uploads.
  }

  provider = new LocalStorageProvider();
  return provider;
}
