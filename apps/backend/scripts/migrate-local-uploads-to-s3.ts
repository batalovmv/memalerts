import '../src/config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { loadS3ConfigFromEnv } from '../src/storage/s3Storage.js';
import { validatePathWithinDirectory } from '../src/utils/pathSecurity.js';
import { Semaphore, parsePositiveIntEnv } from '../src/utils/semaphore.js';

/**
 * Migrate local /uploads/memes files to S3 and rewrite DB file URLs.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-local-uploads-to-s3.ts
 *
 * Required env:
 *   UPLOAD_STORAGE=s3
 *   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL
 *
 * Optional env:
 *   S3_ENDPOINT, S3_REGION, S3_KEY_PREFIX, S3_FORCE_PATH_STYLE
 *   S3_MIGRATE_BATCH=200
 *   S3_MIGRATE_CONCURRENCY=4
 *   S3_MIGRATE_DELETE_LOCAL=1
 */

type S3Config = NonNullable<ReturnType<typeof loadS3ConfigFromEnv>>;

function isTruthy(value: string | undefined): boolean {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function safeJoinUrl(base: string, pathPart: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = pathPart.startsWith('/') ? pathPart.slice(1) : pathPart;
  return `${b}/${p}`;
}

function makeKey(cfg: S3Config, hash: string, extWithDot: string): string {
  const prefix = cfg.keyPrefix ? cfg.keyPrefix.replace(/\/+$/, '') + '/' : '';
  return `${prefix}memes/${hash}${extWithDot}`;
}

function publicUploadsPathToLocal(publicPath: string, uploadsRoot: string): string | null {
  const p = String(publicPath || '').trim();
  if (!p.startsWith('/uploads/')) return null;
  const rel = p.replace(/^\/uploads\//, '');
  try {
    return validatePathWithinDirectory(rel, uploadsRoot);
  } catch {
    return null;
  }
}

async function uploadToS3(opts: {
  client: S3Client;
  cfg: S3Config;
  localPath: string;
  key: string;
  mimeType: string;
}): Promise<void> {
  const { client, cfg, localPath, key, mimeType } = opts;
  const body = fs.createReadStream(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType || undefined,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
}

async function main() {
  const cfg = loadS3ConfigFromEnv();
  if (!cfg) {
    logger.error('s3.migrate.missing_env', {
      required: ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'],
    });
    process.exitCode = 1;
    return;
  }

  const uploadStorage = String(process.env.UPLOAD_STORAGE || '')
    .trim()
    .toLowerCase();
  if (uploadStorage && uploadStorage !== 's3') {
    logger.warn('s3.migrate.upload_storage_mismatch', { uploadStorage });
  }

  const batch = Math.max(10, Math.min(parsePositiveIntEnv('S3_MIGRATE_BATCH', 200), 2000));
  const concurrency = Math.max(1, Math.min(parsePositiveIntEnv('S3_MIGRATE_CONCURRENCY', 4), 20));
  const deleteLocal = isTruthy(process.env.S3_MIGRATE_DELETE_LOCAL);
  const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');

  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  const sem = new Semaphore(concurrency);

  const stats = {
    total: 0,
    uploaded: 0,
    updated: 0,
    refUpdates: 0,
    variantUpdated: 0,
    missing: 0,
    skipped: 0,
    errors: 0,
  };

  logger.info('s3.migrate.start', {
    batch,
    concurrency,
    deleteLocal,
    uploadsRoot,
    keyPrefix: cfg.keyPrefix || null,
  });

  let lastHash: string | null = null;

  for (;;) {
    const rows = await prisma.fileHash.findMany({
      where: {
        filePath: { startsWith: '/uploads/' },
        ...(lastHash ? { hash: { gt: lastHash } } : {}),
      },
      orderBy: { hash: 'asc' },
      take: batch,
      select: { hash: true, filePath: true, mimeType: true },
    });

    if (rows.length === 0) break;
    lastHash = rows[rows.length - 1]!.hash;

    await Promise.all(
      rows.map((row) =>
        sem.use(async () => {
          stats.total += 1;
          const oldPath = String(row.filePath || '').trim();
          if (!oldPath.startsWith('/uploads/')) {
            stats.skipped += 1;
            return;
          }

          const localPath = publicUploadsPathToLocal(oldPath, uploadsRoot);
          if (!localPath) {
            stats.skipped += 1;
            logger.warn('s3.migrate.invalid_path', { hash: row.hash, filePath: oldPath });
            return;
          }

          if (!fs.existsSync(localPath)) {
            stats.missing += 1;
            logger.warn('s3.migrate.missing_file', { hash: row.hash, localPath, filePath: oldPath });
            return;
          }

          const extWithDot = path.extname(localPath) || '';
          const key = makeKey(cfg, row.hash, extWithDot);
          const newPath = safeJoinUrl(cfg.publicBaseUrl, key);

          try {
            await uploadToS3({
              client,
              cfg,
              localPath,
              key,
              mimeType: row.mimeType,
            });
            stats.uploaded += 1;
          } catch (error) {
            stats.errors += 1;
            const err = error as { message?: string };
            logger.error('s3.migrate.upload_failed', {
              hash: row.hash,
              localPath,
              key,
              errorMessage: err.message || String(error),
            });
            return;
          }

          try {
            const updates = await prisma.$transaction(async (tx) => {
              await tx.fileHash.update({
                where: { hash: row.hash },
                data: { filePath: newPath },
              });
              const memeRes = await tx.meme.updateMany({ where: { fileUrl: oldPath }, data: { fileUrl: newPath } });
              const assetRes = await tx.memeAsset.updateMany({
                where: { fileUrl: oldPath },
                data: { fileUrl: newPath },
              });
              const playRes = await tx.memeAsset.updateMany({
                where: { playFileUrl: oldPath },
                data: { playFileUrl: newPath },
              });
              const submissionRes = await tx.memeSubmission.updateMany({
                where: { fileUrlTemp: oldPath },
                data: { fileUrlTemp: newPath },
              });
              return { memeRes, assetRes, playRes, submissionRes };
            });

            stats.updated += 1;
            stats.refUpdates +=
              updates.memeRes.count + updates.assetRes.count + updates.playRes.count + updates.submissionRes.count;
          } catch (error) {
            stats.errors += 1;
            const err = error as { message?: string };
            logger.error('s3.migrate.db_failed', {
              hash: row.hash,
              filePath: oldPath,
              errorMessage: err.message || String(error),
            });
            return;
          }

          if (deleteLocal) {
            try {
              await fs.promises.unlink(localPath);
            } catch (error) {
              const err = error as { message?: string };
              logger.warn('s3.migrate.local_delete_failed', {
                hash: row.hash,
                localPath,
                errorMessage: err.message || String(error),
              });
            }
          }
        })
      )
    );

    logger.info('s3.migrate.progress', {
      total: stats.total,
      uploaded: stats.uploaded,
      updated: stats.updated,
      missing: stats.missing,
      skipped: stats.skipped,
      errors: stats.errors,
    });
  }

  const publicBase = cfg.publicBaseUrl.replace(/\/+$/, '');
  const publicBaseSql = publicBase.replace(/'/g, "''");

  const variantUpdateResult = await prisma.$executeRawUnsafe(
    `UPDATE "MemeAssetVariant" v
     SET "fileUrl" = fh."filePath"
     FROM "FileHash" fh
     WHERE v."fileHash" = fh."hash"
       AND v."fileUrl" LIKE '/uploads/%'
       AND fh."filePath" LIKE '${publicBaseSql}/%';`
  );
  stats.variantUpdated += Number(variantUpdateResult) || 0;

  const [fileHashLeft, memeLeft, assetLeft, playLeft, submissionLeft, variantLeftRows] = await prisma.$transaction([
    prisma.fileHash.count({ where: { filePath: { startsWith: '/uploads/' } } }),
    prisma.meme.count({ where: { fileUrl: { startsWith: '/uploads/' } } }),
    prisma.memeAsset.count({ where: { fileUrl: { startsWith: '/uploads/' } } }),
    prisma.memeAsset.count({ where: { playFileUrl: { startsWith: '/uploads/' } } }),
    prisma.memeSubmission.count({ where: { fileUrlTemp: { startsWith: '/uploads/' } } }),
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "MemeAssetVariant" WHERE "fileUrl" LIKE '/uploads/%';`),
  ]);
  const variantLeft = Number(variantLeftRows?.[0]?.count) || 0;

  logger.info('s3.migrate.done', {
    total: stats.total,
    uploaded: stats.uploaded,
    updated: stats.updated,
    refUpdates: stats.refUpdates,
    variantUpdated: stats.variantUpdated,
    missing: stats.missing,
    skipped: stats.skipped,
    errors: stats.errors,
    remaining: {
      fileHash: fileHashLeft,
      meme: memeLeft,
      memeAsset: assetLeft,
      playFileUrl: playLeft,
      submission: submissionLeft,
      memeAssetVariant: variantLeft,
    },
  });

  if (stats.errors > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    const err = error as { message?: string };
    logger.error('s3.migrate.fatal', { errorMessage: err.message || String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
