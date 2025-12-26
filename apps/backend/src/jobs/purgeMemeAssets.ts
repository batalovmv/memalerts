import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

type PurgeOptions = {
  batchSize: number;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export async function purgeMemeAssetsOnce(opts: PurgeOptions): Promise<{
  scanned: number;
  purged: number;
  channelMemesDisabled: number;
}> {
  const batchSize = clampInt(opts.batchSize, 1, 1000, 200);
  const now = new Date();

  const rows = await prisma.memeAsset.findMany({
    where: {
      purgedAt: null,
      purgeNotBefore: { not: null, lte: now },
    },
    select: {
      id: true,
    },
    take: batchSize,
    orderBy: { purgeNotBefore: 'asc' },
  });

  let purged = 0;
  let channelMemesDisabled = 0;

  for (const r of rows) {
    try {
      const res = await prisma.$transaction(async (tx) => {
        await tx.memeAsset.update({
          where: { id: r.id },
          data: {
            purgedAt: now,
            // Keep hidden in pool permanently once purged.
            poolVisibility: 'hidden',
          },
        });

        const upd = await tx.channelMeme.updateMany({
          where: { memeAssetId: r.id, deletedAt: null },
          data: { status: 'disabled', deletedAt: now },
        });

        return { disabled: upd.count };
      });

      purged += 1;
      channelMemesDisabled += res.disabled;
    } catch (e: any) {
      logger.warn('purge.meme_assets.item_failed', {
        memeAssetId: r.id,
        errorMessage: e?.message,
      });
    }
  }

  return { scanned: rows.length, purged, channelMemesDisabled };
}

export function startMemeAssetPurgeScheduler() {
  const batchSizeRaw = parseInt(String(process.env.MEME_ASSET_PURGE_BATCH || ''), 10);
  const intervalMsRaw = parseInt(String(process.env.MEME_ASSET_PURGE_INTERVAL_MS || ''), 10);
  const initialDelayMsRaw = parseInt(String(process.env.MEME_ASSET_PURGE_INITIAL_DELAY_MS || ''), 10);

  const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? Math.min(batchSizeRaw, 1000) : 200;
  const intervalMs = Number.isFinite(intervalMsRaw) ? Math.max(60_000, intervalMsRaw) : 60 * 60_000; // hourly
  const initialDelayMs = Number.isFinite(initialDelayMsRaw) ? Math.max(0, initialDelayMsRaw) : 5 * 60_000; // 5 min

  let running = false;
  // Ensure only one instance (prod or beta) runs purge on shared DB.
  const lockId = 421350n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    let locked = false;
    try {
      locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;

      const res = await purgeMemeAssetsOnce({ batchSize });
      logger.info('purge.meme_assets.completed', {
        batchSize,
        durationMs: Date.now() - startedAt,
        ...res,
      });
    } catch (e: any) {
      logger.error('purge.meme_assets.failed', {
        batchSize,
        durationMs: Date.now() - startedAt,
        errorMessage: e?.message,
      });
    } finally {
      if (locked) await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  setInterval(() => void runOnce(), intervalMs);
}


