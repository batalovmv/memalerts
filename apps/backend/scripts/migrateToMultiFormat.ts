import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { computeContentHash, isCurrentHashVersion } from '../src/utils/media/contentHash.js';
import { resolveLocalMediaPath } from '../src/utils/media/resolveMediaPath.js';
import { ensureMemeAssetVariants } from '../src/services/memeAsset/ensureVariants.js';

/**
 * Migrate existing MemeAsset rows to multi-format variants + contentHash.
 *
 * Usage:
 *   pnpm tsx scripts/migrateToMultiFormat.ts --dry-run
 *   pnpm tsx scripts/migrateToMultiFormat.ts --batch=200
 *   pnpm tsx scripts/migrateToMultiFormat.ts --checkpoint=<last-asset-id>
 */

type MigrationStats = {
  processed: number;
  hashesSet: number;
  duplicatesMerged: number;
  variantsEnsured: number;
  channelMemesMoved: number;
  channelMemesDisabled: number;
  legacyVariantsRemoved: number;
  missingFileUrl: number;
  missingSource: number;
  fallbackSources: number;
  errors: number;
};

type MigrationOptions = {
  dryRun: boolean;
  batchSize: number;
  checkpoint?: string;
};

type MemeAssetSnapshot = {
  id: string;
  fileUrl: string | null;
  fileHash: string | null;
  durationMs: number;
  createdAt: Date;
  aiStatus: string;
  aiAutoTitle: string | null;
  aiAutoTagNamesJson: unknown | null;
  aiAutoDescription: string | null;
  aiCompletedAt: Date | null;
  contentHash: string | null;
  purgeRequestedAt: Date | null;
  purgedAt: Date | null;
  variants?: Array<{
    format: string;
    status: string;
    fileUrl: string;
    priority: number;
  }>;
};

const DEFAULT_BATCH = 100;
const LOG_EVERY = 100;

function parseArgs(argv: string[]): MigrationOptions {
  const dryRun = argv.includes('--dry-run');
  const batchSizeArg = argv.find((arg) => arg.startsWith('--batch='));
  const batchSize = Math.max(10, parseInt(batchSizeArg?.split('=')[1] ?? '', 10) || DEFAULT_BATCH);
  const checkpointArg = argv.find((arg) => arg.startsWith('--checkpoint='));
  const checkpoint = checkpointArg?.split('=')[1];
  return { dryRun, batchSize, checkpoint };
}

function scoreCanonical(asset: MemeAssetSnapshot): number {
  let score = 0;
  if (asset.aiStatus === 'done') score += 10;
  if (asset.aiAutoTitle) score += 2;
  if (asset.aiAutoTagNamesJson) score += 2;
  if (asset.aiAutoDescription) score += 1;
  if (asset.fileUrl) score += 1;
  return score;
}

function pickCanonical(candidates: MemeAssetSnapshot[]): MemeAssetSnapshot {
  return candidates
    .slice()
    .sort((a, b) => {
      const scoreDiff = scoreCanonical(b) - scoreCanonical(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })[0]!;
}

function pickFallbackVariant(
  variants: Array<{ format: string; status: string; fileUrl: string; priority: number }> | undefined | null
): { url: string; format: 'mp4' | 'webm' } | null {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const order: Array<'mp4' | 'webm'> = ['mp4', 'webm'];
  for (const format of order) {
    const candidate = variants.find(
      (variant) =>
        String(variant.format || '') === format &&
        String(variant.status || '') === 'done' &&
        String(variant.fileUrl || '').trim().length > 0
    );
    if (candidate?.fileUrl) {
      return { url: candidate.fileUrl, format };
    }
  }
  return null;
}

async function mergeDuplicateAsset(params: {
  duplicate: MemeAssetSnapshot;
  canonical: MemeAssetSnapshot;
  contentHash: string;
  dryRun: boolean;
  stats: MigrationStats;
}): Promise<void> {
  const { duplicate, canonical, contentHash, dryRun, stats } = params;
  if (dryRun) return;

  await prisma.$transaction(async (tx) => {
    if (!canonical.contentHash) {
      await tx.memeAsset.update({
        where: { id: canonical.id },
        data: { contentHash },
      });
    }

    const canonicalUpdate: Record<string, unknown> = {};
    if (!canonical.fileUrl && duplicate.fileUrl) canonicalUpdate.fileUrl = duplicate.fileUrl;
    if (!canonical.fileHash && duplicate.fileHash) canonicalUpdate.fileHash = duplicate.fileHash;
    if (!canonical.durationMs && duplicate.durationMs) canonicalUpdate.durationMs = duplicate.durationMs;

    if (Object.keys(canonicalUpdate).length > 0) {
      await tx.memeAsset.update({
        where: { id: canonical.id },
        data: canonicalUpdate,
      });
    }

    const channelMemes = await tx.channelMeme.findMany({
      where: { memeAssetId: duplicate.id },
      select: { id: true, channelId: true },
    });

    for (const channelMeme of channelMemes) {
      const existing = await tx.channelMeme.findUnique({
        where: { channelId_memeAssetId: { channelId: channelMeme.channelId, memeAssetId: canonical.id } },
        select: { id: true },
      });

      if (!existing) {
        await tx.channelMeme.update({
          where: { id: channelMeme.id },
          data: { memeAssetId: canonical.id },
        });
        stats.channelMemesMoved += 1;
      } else {
        await tx.channelMeme.update({
          where: { id: channelMeme.id },
          data: { status: 'disabled', deletedAt: new Date() },
        });
        stats.channelMemesDisabled += 1;
      }
    }

    await tx.memeAsset.update({
      where: { id: duplicate.id },
      data: {
        purgeRequestedAt: new Date(),
        purgeReason: 'duplicate_merged',
      },
    });
  });
}

async function migrateExistingAssets(options: MigrationOptions): Promise<MigrationStats> {
  const { dryRun, batchSize, checkpoint } = options;
  const stats: MigrationStats = {
    processed: 0,
    hashesSet: 0,
    duplicatesMerged: 0,
    variantsEnsured: 0,
    channelMemesMoved: 0,
    channelMemesDisabled: 0,
    legacyVariantsRemoved: 0,
    missingFileUrl: 0,
    missingSource: 0,
    fallbackSources: 0,
    errors: 0,
  };

  logger.info('migration.multi_format.start', { dryRun, batchSize, checkpoint: checkpoint ?? null });

  if (!dryRun) {
    const removed = await prisma.memeAssetVariant.deleteMany({
      where: { format: { notIn: ['preview', 'webm', 'mp4'] } },
    });
    stats.legacyVariantsRemoved = removed.count;
    logger.info('migration.multi_format.legacy_removed', { removed: removed.count });
  }

  let cursor: string | null = checkpoint ?? null;
  const ensuredVariants = new Set<string>();

  for (;;) {
    const assets = await prisma.memeAsset.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: batchSize,
      orderBy: { id: 'asc' },
      where: {
        type: 'video',
        purgedAt: null,
        purgeRequestedAt: null,
        OR: [
          { contentHash: null },
          { contentHash: { not: { startsWith: 'v2:' } } },
          { variants: { none: { format: 'preview', status: 'done' } } },
          { variants: { none: { format: 'webm', status: 'done' } } },
          { variants: { none: { format: 'mp4', status: 'done' } } },
        ],
      },
      select: {
        id: true,
        fileUrl: true,
        fileHash: true,
        durationMs: true,
        createdAt: true,
        aiStatus: true,
        aiAutoTitle: true,
        aiAutoTagNamesJson: true,
        aiAutoDescription: true,
        aiCompletedAt: true,
        contentHash: true,
        purgeRequestedAt: true,
        purgedAt: true,
        variants: {
          select: {
            format: true,
            status: true,
            fileUrl: true,
            priority: true,
          },
        },
      },
    });

    if (assets.length === 0) break;
    cursor = assets[assets.length - 1]!.id;

    for (const asset of assets as MemeAssetSnapshot[]) {
      stats.processed += 1;

      let sourceFileUrl = asset.fileUrl ?? '';
      let usedFallback = false;

      if (!sourceFileUrl) {
        const fallback = pickFallbackVariant(asset.variants);
        if (fallback) {
          sourceFileUrl = fallback.url;
          usedFallback = true;
          stats.fallbackSources += 1;
          logger.warn('migration.multi_format.fallback_source', {
            assetId: asset.id,
            fallbackFormat: fallback.format,
            fallbackUrl: fallback.url,
          });
        } else {
          stats.missingFileUrl += 1;
          continue;
        }
      }

      let resolved = await resolveLocalMediaPath(sourceFileUrl);
      if (!resolved && !usedFallback) {
        const fallback = pickFallbackVariant(asset.variants);
        if (fallback) {
          sourceFileUrl = fallback.url;
          usedFallback = true;
          stats.fallbackSources += 1;
          logger.warn('migration.multi_format.fallback_source', {
            assetId: asset.id,
            fallbackFormat: fallback.format,
            fallbackUrl: fallback.url,
          });
          resolved = await resolveLocalMediaPath(sourceFileUrl);
        }
      }

      if (!resolved) {
        stats.missingSource += 1;
        continue;
      }

      try {
        const needsHash = !asset.contentHash || !isCurrentHashVersion(asset.contentHash);
        const contentHash = needsHash ? await computeContentHash(resolved.localPath) : asset.contentHash;

        const existing = await prisma.memeAsset.findMany({
          where: {
            contentHash,
            id: { not: asset.id },
          },
          select: {
            id: true,
            fileUrl: true,
            fileHash: true,
            durationMs: true,
            createdAt: true,
            aiStatus: true,
            aiAutoTitle: true,
            aiAutoTagNamesJson: true,
            aiAutoDescription: true,
            aiCompletedAt: true,
            contentHash: true,
            purgeRequestedAt: true,
            purgedAt: true,
          },
        });

        if (existing.length > 0) {
          const candidates = [asset, ...existing];
          const activeCandidates = candidates.filter((candidate) => !candidate.purgedAt && !candidate.purgeRequestedAt);
          const canonical = pickCanonical(activeCandidates.length > 0 ? activeCandidates : candidates);
          const duplicates = candidates.filter(
            (candidate) => candidate.id !== canonical.id && !candidate.purgeRequestedAt
          );

          for (const duplicate of duplicates) {
            stats.duplicatesMerged += 1;
            await mergeDuplicateAsset({
              duplicate,
              canonical,
              contentHash,
              dryRun,
              stats,
            });
          }

          if (!ensuredVariants.has(canonical.id)) {
            const fallback = duplicates.find((item) => item.fileUrl) ?? null;
            const sourceFileUrl = canonical.fileUrl ?? fallback?.fileUrl ?? null;
            const sourceFileHash =
              canonical.fileUrl && canonical.fileHash ? canonical.fileHash : fallback?.fileHash ?? canonical.fileHash;
            const sourceDurationMs =
              canonical.fileUrl && canonical.durationMs ? canonical.durationMs : fallback?.durationMs ?? canonical.durationMs;
            if (!dryRun && sourceFileUrl) {
              await ensureMemeAssetVariants({
                memeAssetId: canonical.id,
                sourceFileUrl,
                sourceFileHash: sourceFileHash ?? undefined,
                sourceDurationMs: sourceDurationMs ?? undefined,
              });
            }
            ensuredVariants.add(canonical.id);
            stats.variantsEnsured += 1;
          }
          continue;
        }

        if (needsHash) {
          if (!dryRun) {
            await prisma.memeAsset.update({
              where: { id: asset.id },
              data: { contentHash },
            });
          }
          stats.hashesSet += 1;
        }

        if (!ensuredVariants.has(asset.id)) {
          if (!dryRun) {
            await ensureMemeAssetVariants({
              memeAssetId: asset.id,
              sourceFileUrl,
              sourceFileHash: usedFallback ? undefined : asset.fileHash ?? undefined,
              sourceDurationMs: asset.durationMs ?? undefined,
            });
          }
          ensuredVariants.add(asset.id);
          stats.variantsEnsured += 1;
        }
      } catch (error) {
        stats.errors += 1;
        logger.warn('migration.multi_format.asset_failed', {
          assetId: asset.id,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } finally {
        try {
          await resolved.cleanup();
        } catch {
          // ignore cleanup errors
        }
      }

      if (stats.processed % LOG_EVERY === 0) {
        logger.info('migration.multi_format.progress', { ...stats, checkpoint: cursor });
      }
    }
  }

  logger.info('migration.multi_format.complete', stats);
  return stats;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stats = await migrateExistingAssets(options);

  console.log('\n=== Migration Summary ===');
  console.log(`Processed: ${stats.processed}`);
  console.log(`Hashes set: ${stats.hashesSet}`);
  console.log(`Duplicates merged: ${stats.duplicatesMerged}`);
  console.log(`Variants ensured: ${stats.variantsEnsured}`);
  console.log(`Legacy variants removed: ${stats.legacyVariantsRemoved}`);
  console.log(`ChannelMemes moved: ${stats.channelMemesMoved}`);
  console.log(`ChannelMemes disabled: ${stats.channelMemesDisabled}`);
  console.log(`Missing fileUrl: ${stats.missingFileUrl}`);
  console.log(`Missing source: ${stats.missingSource}`);
  console.log(`Fallback sources: ${stats.fallbackSources}`);
  console.log(`Errors: ${stats.errors}`);
}

main()
  .catch((error) => {
    logger.error('migration.multi_format.failed', { errorMessage: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
