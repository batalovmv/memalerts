import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const s3Mocks = vi.hoisted(() => {
  const clients: Array<{ send: ReturnType<typeof vi.fn> }> = [];
  const send = vi.fn();
  class S3Client {
    public send: ReturnType<typeof vi.fn>;
    constructor() {
      this.send = send;
      clients.push(this);
    }
  }
  class PutObjectCommand {
    public input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    public input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, send, clients };
});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: s3Mocks.S3Client,
  PutObjectCommand: s3Mocks.PutObjectCommand,
  DeleteObjectCommand: s3Mocks.DeleteObjectCommand,
}));

const baseEnv = { ...process.env };

async function makeTempDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

beforeEach(() => {
  process.env = { ...baseEnv };
  s3Mocks.send.mockReset();
  s3Mocks.clients.length = 0;
  vi.resetModules();
});

afterEach(async () => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('storage: local', () => {
  it('stores and deletes meme files locally', async () => {
    const uploadsDir = await makeTempDir('memalerts-uploads-');
    const tempDir = await makeTempDir('memalerts-temp-');
    process.env.UPLOAD_DIR = uploadsDir;

    const tempFile = path.join(tempDir, 'temp.mp4');
    await fs.writeFile(tempFile, Buffer.from('data'));

    const { LocalStorageProvider } = await import('../src/storage/localStorage.js');
    const provider = new LocalStorageProvider();
    const result = await provider.storeMemeFromTemp({
      tempFilePath: tempFile,
      hash: 'hash1',
      extWithDot: '.mp4',
    });

    expect(result.publicPath).toBe('/uploads/memes/hash1.mp4');
    const storedPath = path.join(uploadsDir, 'memes', 'hash1.mp4');
    await expect(fs.stat(storedPath)).resolves.toBeDefined();
    await expect(fs.stat(tempFile)).rejects.toBeTruthy();

    await provider.deleteByPublicPath('/uploads/memes/hash1.mp4');
    await expect(fs.stat(storedPath)).rejects.toBeTruthy();

    await fs.rm(uploadsDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

describe('storage: s3', () => {
  it('stores and deletes objects via s3 client', async () => {
    const tempDir = await makeTempDir('memalerts-temp-');
    const tempFile = path.join(tempDir, 'temp.mp4');
    await fs.writeFile(tempFile, Buffer.from('data'));

    vi.spyOn(fsSync, 'createReadStream').mockReturnValue(Readable.from([]) as unknown as fsSync.ReadStream);
    s3Mocks.send.mockResolvedValueOnce({});

    const { S3StorageProvider } = await import('../src/storage/s3Storage.js');
    const provider = new S3StorageProvider({
      region: 'auto',
      bucket: 'bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      publicBaseUrl: 'https://cdn.example',
      keyPrefix: 'prefix',
      forcePathStyle: true,
    });

    const stored = await provider.storeMemeFromTemp({
      tempFilePath: tempFile,
      hash: 'hash1',
      extWithDot: '.mp4',
      mimeType: 'video/mp4',
    });

    expect(stored.publicPath).toBe('https://cdn.example/prefix/memes/hash1.mp4');
    expect(stored.key).toBe('prefix/memes/hash1.mp4');
    expect(s3Mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'bucket', Key: 'prefix/memes/hash1.mp4' }),
      })
    );

    s3Mocks.send.mockResolvedValueOnce({});
    await provider.deleteByPublicPath('https://cdn.example/prefix/memes/hash1.mp4');
    expect(s3Mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'bucket', Key: 'prefix/memes/hash1.mp4' }),
      })
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads s3 config from env', async () => {
    process.env.S3_BUCKET = 'bucket';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example';
    process.env.S3_ENDPOINT = 'https://s3.example';
    process.env.S3_KEY_PREFIX = 'prefix';

    const { loadS3ConfigFromEnv } = await import('../src/storage/s3Storage.js');
    const cfg = loadS3ConfigFromEnv();

    expect(cfg).toMatchObject({
      bucket: 'bucket',
      publicBaseUrl: 'https://cdn.example',
      keyPrefix: 'prefix',
      forcePathStyle: true,
    });
  });
});

describe('storage: provider factory', () => {
  it('returns local provider by default and s3 when configured', async () => {
    process.env.UPLOAD_STORAGE = 'local';
    const { getStorageProvider } = await import('../src/storage/index.js');
    const local = getStorageProvider();
    expect(local.kind).toBe('local');

    vi.resetModules();
    process.env.UPLOAD_STORAGE = 's3';
    process.env.S3_BUCKET = 'bucket';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example';
    const { getStorageProvider: getStorageProviderS3 } = await import('../src/storage/index.js');
    const s3 = getStorageProviderS3();
    expect(s3.kind).toBe('s3');
  });
});
