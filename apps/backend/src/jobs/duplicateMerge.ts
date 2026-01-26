import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function isSchedulerEnabled(): boolean {
  const raw = String(process.env.DUPLICATE_MERGE_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

type DuplicateGroupRow = { fileHash: string; ids: string[]; cnt: number };

async function loadDuplicateGroups(): Promise<DuplicateGroupRow[]> {
  const rows = await prisma.$queryRaw<DuplicateGroupRow[]>`
    SELECT "fileHash", array_agg(id) as ids, COUNT(*)::int as cnt
    FROM "MemeAsset"
    WHERE "fileHash" IS NOT NULL AND "deletedAt" IS NULL
    GROUP BY "fileHash"
    HAVING COUNT(*) > 1
  `;
  return rows ?? [];
}

async function mergeDuplicate(primaryId: string, duplicateId: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "UserMemeFavorite" f
      USING "UserMemeFavorite" f2
      WHERE f."memeAssetId" = ${duplicateId}
        AND f2."memeAssetId" = ${primaryId}
        AND f."userId" = f2."userId"
        AND f."channelId" = f2."channelId"
    `;
    await tx.$executeRaw`
      UPDATE "UserMemeFavorite"
      SET "memeAssetId" = ${primaryId}, "updatedAt" = ${now}
      WHERE "memeAssetId" = ${duplicateId}
    `;

    await tx.$executeRaw`
      DELETE FROM "UserMemeBlocklist" b
      USING "UserMemeBlocklist" b2
      WHERE b."memeAssetId" = ${duplicateId}
        AND b2."memeAssetId" = ${primaryId}
        AND b."userId" = b2."userId"
        AND b."channelId" = b2."channelId"
    `;
    await tx.$executeRaw`
      UPDATE "UserMemeBlocklist"
      SET "memeAssetId" = ${primaryId}, "updatedAt" = ${now}
      WHERE "memeAssetId" = ${duplicateId}
    `;

    await tx.$executeRaw`
      DELETE FROM "ChannelMemeBlocklist" cb
      USING "ChannelMemeBlocklist" cb2
      WHERE cb."memeAssetId" = ${duplicateId}
        AND cb2."memeAssetId" = ${primaryId}
        AND cb."channelId" = cb2."channelId"
    `;
    await tx.$executeRaw`
      UPDATE "ChannelMemeBlocklist"
      SET "memeAssetId" = ${primaryId}
      WHERE "memeAssetId" = ${duplicateId}
    `;

    await tx.$executeRaw`
      UPDATE "ChannelMeme" cm
      SET "memeAssetId" = ${primaryId}
      WHERE cm."memeAssetId" = ${duplicateId}
        AND NOT EXISTS (
          SELECT 1 FROM "ChannelMeme" cm2
          WHERE cm2."channelId" = cm."channelId"
            AND cm2."memeAssetId" = ${primaryId}
            AND cm2."deletedAt" IS NULL
        )
    `;
    await tx.$executeRaw`
      UPDATE "ChannelMeme"
      SET "status" = 'disabled',
          "deletedAt" = COALESCE("deletedAt", ${now})
      WHERE "memeAssetId" = ${duplicateId}
        AND EXISTS (
          SELECT 1 FROM "ChannelMeme" cm2
          WHERE cm2."channelId" = "ChannelMeme"."channelId"
            AND cm2."memeAssetId" = ${primaryId}
            AND cm2."deletedAt" IS NULL
        )
    `;

    await tx.$executeRaw`
      DELETE FROM "MemeAssetVariant" v
      USING "MemeAssetVariant" v2
      WHERE v."memeAssetId" = ${duplicateId}
        AND v2."memeAssetId" = ${primaryId}
        AND v."format" = v2."format"
    `;
    await tx.$executeRaw`
      UPDATE "MemeAssetVariant" v
      SET "memeAssetId" = ${primaryId}
      WHERE v."memeAssetId" = ${duplicateId}
        AND NOT EXISTS (
          SELECT 1 FROM "MemeAssetVariant" v2
          WHERE v2."memeAssetId" = ${primaryId}
            AND v2."format" = v."format"
        )
    `;

    await tx.memeAsset.update({
      where: { id: duplicateId },
      data: {
        status: 'deleted',
        deletedAt: now,
      },
    });
  });
}

export async function mergeDuplicateMemeAssets(): Promise<{ groups: number; merged: number }> {
  const groups = await loadDuplicateGroups();
  if (groups.length === 0) return { groups: 0, merged: 0 };

  let merged = 0;
  for (const group of groups) {
    if (!Array.isArray(group.ids) || group.ids.length < 2) continue;
    const assets = await prisma.memeAsset.findMany({
      where: { id: { in: group.ids } },
      select: { id: true, qualityScore: true, createdAt: true },
      orderBy: [{ qualityScore: 'desc' }, { createdAt: 'asc' }],
    });
    if (assets.length < 2) continue;
    const primary = assets[0];
    const duplicates = assets.slice(1);

    for (const dup of duplicates) {
      await mergeDuplicate(primary.id, dup.id);
      merged += 1;
    }
  }

  return { groups: groups.length, merged };
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startDuplicateMergeScheduler(): void {
  if (!isSchedulerEnabled()) {
    logger.info('duplicate_merge.scheduler_disabled');
    return;
  }

  const intervalRaw = parseInt(String(process.env.DUPLICATE_MERGE_INTERVAL_MS || ''), 10);
  const initialDelayRaw = parseInt(String(process.env.DUPLICATE_MERGE_INITIAL_DELAY_MS || ''), 10);
  const intervalMs = clampInt(intervalRaw, 10 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
  const initialDelayMs = clampInt(initialDelayRaw, 0, 6 * 60 * 60 * 1000, 5 * 60 * 1000);

  const lockId = 903212n;
  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      const locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await mergeDuplicateMemeAssets();
      if (res.merged > 0) {
        logger.info('duplicate_merge.completed', {
          groups: res.groups,
          merged: res.merged,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.error('duplicate_merge.failed', { errorMessage: errMsg, durationMs: Date.now() - startedAt });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  schedulerTimer = setInterval(() => void runOnce(), intervalMs);

  logger.info('duplicate_merge.scheduler_started', { intervalMs, initialDelayMs });
}

export function stopDuplicateMergeScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
