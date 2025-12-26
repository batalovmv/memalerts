import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';

/**
 * Backfill MemeAsset + ChannelMeme from legacy Meme rows.
 *
 * Safe-ish to run multiple times:
 * - ChannelMeme is upserted on (channelId, memeAssetId).
 * - MemeAsset is deduped primarily by fileHash; if fileHash is null, we try a best-effort match by (fileUrl,type,durationMs).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-meme-assets.ts
 */

type LegacyMeme = {
  id: string;
  channelId: string;
  title: string;
  type: string;
  fileUrl: string;
  fileHash: string | null;
  durationMs: number;
  priceCoins: number;
  status: string;
  deletedAt: Date | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: Date;
};

function mapLegacyStatusToChannelMemeStatus(status: string): { status: string; deletedAt: Date | null } {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return { status: 'approved', deletedAt: null };
  if (s === 'pending') return { status: 'pending', deletedAt: null };
  if (s === 'rejected') return { status: 'rejected', deletedAt: null };
  if (s === 'deleted') return { status: 'disabled', deletedAt: new Date() };
  // Unknown legacy statuses -> keep disabled to avoid surfacing unexpectedly.
  return { status: 'disabled', deletedAt: new Date() };
}

async function findOrCreateMemeAsset(m: LegacyMeme) {
  // 1) Prefer dedup by fileHash (strongest key).
  if (m.fileHash) {
    const existing = await prisma.memeAsset.findFirst({
      where: { fileHash: m.fileHash },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false, matchedBy: 'fileHash' as const };

    const created = await prisma.memeAsset.create({
      data: {
        type: m.type,
        fileUrl: m.fileUrl || null,
        fileHash: m.fileHash,
        durationMs: m.durationMs,
        createdByUserId: m.createdByUserId || null,
        createdAt: m.createdAt,
      },
      select: { id: true },
    });
    return { id: created.id, created: true, matchedBy: 'fileHash' as const };
  }

  // 2) Best-effort fallback: match by (fileUrl,type,durationMs).
  // This is not guaranteed unique, but prevents obvious duplicates on reruns.
  const existing = await prisma.memeAsset.findFirst({
    where: {
      fileHash: null,
      fileUrl: m.fileUrl || null,
      type: m.type,
      durationMs: m.durationMs,
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false, matchedBy: 'fileUrl' as const };

  const created = await prisma.memeAsset.create({
    data: {
      type: m.type,
      fileUrl: m.fileUrl || null,
      fileHash: null,
      durationMs: m.durationMs,
      createdByUserId: m.createdByUserId || null,
      createdAt: m.createdAt,
    },
    select: { id: true },
  });
  return { id: created.id, created: true, matchedBy: 'fileUrl' as const };
}

async function main() {
  const BATCH = Math.max(10, Math.min(parseInt(String(process.env.BACKFILL_BATCH || '500'), 10) || 500, 2000));

  logger.info('backfill.meme_assets.start', { batch: BATCH });

  let cursor: string | null = null;
  let processed = 0;
  let assetsCreated = 0;
  let channelMemesCreated = 0;
  let channelMemesUpdated = 0;

  for (;;) {
    const memes = await prisma.meme.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: BATCH,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        channelId: true,
        title: true,
        type: true,
        fileUrl: true,
        fileHash: true,
        durationMs: true,
        priceCoins: true,
        status: true,
        deletedAt: true,
        createdByUserId: true,
        approvedByUserId: true,
        createdAt: true,
      },
    });

    if (memes.length === 0) break;
    cursor = memes[memes.length - 1]!.id;

    for (const m of memes as unknown as LegacyMeme[]) {
      processed++;

      // Skip truly deleted rows (soft-deleted in legacy). They can be reintroduced later if needed.
      if (m.deletedAt) continue;

      const asset = await findOrCreateMemeAsset(m);
      if (asset.created) assetsCreated++;

      const mapped = mapLegacyStatusToChannelMemeStatus(m.status);

      const existing = await prisma.channelMeme.findUnique({
        where: { channelId_memeAssetId: { channelId: m.channelId, memeAssetId: asset.id } },
        select: { id: true },
      });

      await prisma.channelMeme.upsert({
        where: { channelId_memeAssetId: { channelId: m.channelId, memeAssetId: asset.id } },
        create: {
          channelId: m.channelId,
          memeAssetId: asset.id,
          legacyMemeId: m.id,
          status: mapped.status,
          deletedAt: mapped.deletedAt,
          title: m.title,
          priceCoins: m.priceCoins,
          addedByUserId: m.createdByUserId || null,
          approvedByUserId: m.approvedByUserId || null,
          approvedAt: m.status === 'approved' ? m.createdAt : null,
          createdAt: m.createdAt,
        },
        update: {
          // Do not overwrite title/price unless you explicitly want legacy to win.
          // Keep status aligned (helps if legacy approve/reject happened before backfill).
          legacyMemeId: m.id,
          status: mapped.status,
          deletedAt: mapped.deletedAt,
          approvedByUserId: m.approvedByUserId || null,
          approvedAt: m.status === 'approved' ? m.createdAt : null,
        },
      });

      if (existing) channelMemesUpdated++;
      else channelMemesCreated++;
    }

    if (processed % (BATCH * 2) === 0) {
      logger.info('backfill.meme_assets.progress', {
        processed,
        assetsCreated,
        channelMemesCreated,
        channelMemesUpdated,
      });
    }
  }

  logger.info('backfill.meme_assets.done', {
    processed,
    assetsCreated,
    channelMemesCreated,
    channelMemesUpdated,
  });
}

main()
  .catch((e) => {
    logger.error('backfill.meme_assets.failed', { err: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


