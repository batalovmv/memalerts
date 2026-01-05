import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function tryExtractSha256FromUploadsPath(fileUrlOrPath: string | null | undefined): string | null {
  const s = String(fileUrlOrPath || '');
  const m = s.match(/\/uploads\/memes\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i);
  return m ? m[1]!.toLowerCase() : null;
}

async function resolveSystemUserIdForChannel(channelId: string): Promise<string | null> {
  const streamer = await prisma.user.findFirst({
    where: { channelId, role: { in: ['streamer', 'admin'] } as any },
    select: { id: true },
  });
  if (streamer?.id) return streamer.id;
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
  return admin?.id ?? null;
}

async function main() {
  const channelId = String(process.env.CHANNEL_ID || '').trim();
  if (!channelId) {
    throw new Error('CHANNEL_ID is required (e.g. CHANNEL_ID=... pnpm tsx scripts/backfill-channelmeme-ai.ts)');
  }

  const limit = clampInt(parseInt(String(process.env.LIMIT || ''), 10), 1, 50_000, 5_000);
  const batch = clampInt(parseInt(String(process.env.BATCH || ''), 10), 1, 500, 50);
  const dryRun = parseBool(process.env.DRY_RUN);

  const systemUserId = await resolveSystemUserIdForChannel(channelId);
  if (!systemUserId) throw new Error('No streamer/admin user found to attribute backfill submissions to');

  const rows = await prisma.channelMeme.findMany({
    where: { channelId, status: 'approved', deletedAt: null },
    take: limit,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      memeAssetId: true,
      title: true,
      aiAutoDescription: true,
      aiAutoTagNamesJson: true,
      searchText: true,
      memeAsset: {
        select: {
          id: true,
          type: true,
          fileUrl: true,
          fileHash: true,
          durationMs: true,
          aiStatus: true,
          aiAutoDescription: true,
          aiAutoTagNamesJson: true,
          aiSearchText: true,
        },
      },
    },
  });

  const missing = rows.filter((r) => !r.aiAutoDescription || r.aiAutoTagNamesJson == null);
  console.log(JSON.stringify({ channelId, totalApproved: rows.length, missingAi: missing.length, dryRun, limit, batch }, null, 2));
  if (missing.length === 0) return;

  let copied = 0;
  let createdSubmissions = 0;
  let processed = 0;
  let skippedNoFileUrl = 0;
  let skippedNoHash = 0;
  let skippedNoAssetAi = 0;

  for (let i = 0; i < missing.length; i++) {
    const r = missing[i]!;
    const asset = r.memeAsset;
    const fileUrl = asset.fileUrl ? String(asset.fileUrl) : null;
    if (!fileUrl) {
      skippedNoFileUrl += 1;
      continue;
    }

    // Best-effort: recover MemeAsset.fileHash from fileUrl when it's a local /uploads/memes/<sha>.* path.
    const recoveredHash = asset.fileHash ? String(asset.fileHash) : tryExtractSha256FromUploadsPath(fileUrl);
    if (!recoveredHash) {
      skippedNoHash += 1;
      continue;
    }

    // Ensure FileHash exists for FK; for local uploads this filePath is stable.
    if (!asset.fileHash) {
      if (!dryRun) {
        // Minimal safe placeholder: fileSize/mimeType are required; try to infer from extension + stat (best-effort).
        let fileSize = 0n;
        let mimeType = 'application/octet-stream';
        if (fileUrl.startsWith('/uploads/')) {
          // Convert public path to absolute path relative to UPLOAD_DIR.
          const uploadsRoot = await (await import('path')).default.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
          const rel = fileUrl.replace(/^\/uploads\//, '');
          const abs = (await import('path')).default.join(uploadsRoot, rel);
          try {
            const st = await (await import('fs')).promises.stat(abs);
            fileSize = BigInt(st.size);
          } catch {
            // keep 0n
          }
          const ext = (await import('path')).default.extname(abs).toLowerCase();
          if (ext === '.webm') mimeType = 'video/webm';
          else if (ext === '.mp4') mimeType = 'video/mp4';
        }

        await prisma.fileHash.upsert({
          where: { hash: recoveredHash },
          create: { hash: recoveredHash, filePath: fileUrl, referenceCount: 1, fileSize, mimeType },
          update: {},
        });

        await prisma.memeAsset.update({
          where: { id: asset.id },
          data: { fileHash: recoveredHash },
        });
      }
    }

    // If MemeAsset already has AI, just copy to ChannelMeme.
    const canCopy =
      String(asset.aiStatus || '') === 'done' &&
      !!asset.aiAutoDescription &&
      asset.aiAutoTagNamesJson != null;
    if (canCopy) {
      if (!dryRun) {
        await prisma.channelMeme.updateMany({
          where: { id: r.id, channelId },
          data: {
            aiAutoDescription: r.aiAutoDescription ? undefined : (asset.aiAutoDescription ?? null),
            aiAutoTagNamesJson: r.aiAutoTagNamesJson == null ? (asset.aiAutoTagNamesJson as any) : undefined,
            searchText: r.searchText ? undefined : (asset.aiSearchText ?? (asset.aiAutoDescription ? String(asset.aiAutoDescription).slice(0, 4000) : null)),
          },
        });
      }
      copied += 1;
      continue;
    }

    // Otherwise: drive the existing AI pipeline via a (deduped) MemeSubmission tied to this MemeAsset.
    // This avoids adding a new "analyze MemeAsset" codepath.
    const existingSub = await prisma.memeSubmission.findFirst({
      where: {
        memeAssetId: asset.id,
        status: { in: ['pending', 'approved'] },
        sourceKind: { in: ['upload', 'url'] },
      } as any,
      orderBy: { createdAt: 'desc' },
      select: { id: true, aiStatus: true },
    });

    const subId = await (async () => {
      if (existingSub?.id) return existingSub.id;
      if (dryRun) return null;
      const created = await prisma.memeSubmission.create({
        data: {
          channelId,
          submitterUserId: systemUserId,
          title: String(r.title || 'Мем').slice(0, 200),
          type: String(asset.type || 'video'),
          fileUrlTemp: fileUrl,
          sourceKind: 'url',
          status: 'approved',
          memeAssetId: asset.id,
          fileHash: recoveredHash,
          durationMs: Number.isFinite(asset.durationMs as any) ? (asset.durationMs as number) : null,
          aiStatus: 'pending',
        } as any,
        select: { id: true },
      });
      createdSubmissions += 1;
      return created.id;
    })();

    if (!subId) continue;

    if (!dryRun) {
      await processOneSubmission(subId);
    }
    processed += 1;

    // Keep the loop cooperative.
    if (processed % batch === 0) {
      console.log(JSON.stringify({ progress: { i: i + 1, total: missing.length, copied, createdSubmissions, processed } }, null, 2));
    }
  }

  console.log(
    JSON.stringify(
      {
        done: {
          channelId,
          totalApproved: rows.length,
          missingAi: missing.length,
          copied,
          createdSubmissions,
          processed,
          skippedNoFileUrl,
          skippedNoHash,
          skippedNoAssetAi,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


