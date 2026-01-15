import 'dotenv/config';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';
import { calculateFileHash, findOrCreateFileHash, getFileStats } from '../src/utils/fileHash.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';

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

function isAllowedExternalBackfillUrl(rawUrl: string): boolean {
  const s = String(rawUrl || '').trim();
  if (!s) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  // Conservative: only allow known MemAlerts CDN/origin.
  return host === 'cdns.memealerts.com' || host.endsWith('.memealerts.com') || host === 'memalerts.com';
}

async function downloadToTempFile(opts: { url: string; maxBytes: number; timeoutMs: number }): Promise<string> {
  const u = new URL(opts.url);
  const lib = u.protocol === 'https:' ? https : http;
  const ext = (() => {
    const e = path.extname(u.pathname || '').toLowerCase();
    if (e && e.length <= 6) return e;
    return '.webm';
  })();

  const tmpDir = path.join(os.tmpdir(), 'memalerts-backfill-ai');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `dl-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      const req = lib.get(
        u,
        {
          headers: { 'User-Agent': 'memalerts-backfill-ai/1.0' },
          signal: ac.signal,
        },
        (res) => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`download_http_${res.statusCode || 'unknown'}`));
            res.resume();
            return;
          }
          let written = 0;
          const out = fs.createWriteStream(tmpPath);
          res.on('data', (chunk: Buffer) => {
            written += chunk.length;
            if (written > opts.maxBytes) {
              reject(new Error(`download_too_large_${written}`));
              req.destroy();
              res.destroy();
              out.destroy();
              return;
            }
          });
          res.on('error', reject);
          out.on('error', reject);
          out.on('finish', () => resolve());
          res.pipe(out);
        }
      );
      req.on('error', reject);
    });
    return tmpPath;
  } catch (e) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // ignore
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function resolveSystemUserIdForChannel(channelId: string): Promise<string | null> {
  const streamer = await prisma.user.findFirst({
    where: { channelId, role: { in: ['streamer', 'admin'] } },
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
  console.log(
    JSON.stringify({ channelId, totalApproved: rows.length, missingAi: missing.length, dryRun, limit, batch }, null, 2)
  );
  if (missing.length === 0) return;

  let copied = 0;
  let createdSubmissions = 0;
  let processed = 0;
  let skippedNoFileUrl = 0;
  let skippedNoHash = 0;
  let skippedNoAssetAi = 0;
  let downloadedAndDeduped = 0;
  let downloadFailed = 0;
  let processFailed = 0;

  for (let i = 0; i < missing.length; i++) {
    const r = missing[i]!;
    const asset = r.memeAsset;
    const fileUrl = asset.fileUrl ? String(asset.fileUrl) : null;
    if (!fileUrl) {
      skippedNoFileUrl += 1;
      continue;
    }

    // Best-effort: recover MemeAsset.fileHash from fileUrl when it's a local /uploads/memes/<sha>.* path.
    let recoveredHash = asset.fileHash ? String(asset.fileHash) : tryExtractSha256FromUploadsPath(fileUrl);

    // If still missing and the file is on a trusted external CDN/origin, download+hash+dedup into our storage.
    if (!recoveredHash && isAllowedExternalBackfillUrl(fileUrl)) {
      if (!dryRun) {
        try {
          const tmp = await downloadToTempFile({
            url: fileUrl,
            maxBytes: clampInt(
              parseInt(String(process.env.BACKFILL_DL_MAX_BYTES || ''), 10),
              1_000_000,
              200_000_000,
              60_000_000
            ),
            timeoutMs: clampInt(
              parseInt(String(process.env.BACKFILL_DL_TIMEOUT_MS || ''), 10),
              5_000,
              10 * 60_000,
              60_000
            ),
          });
          const hash = await calculateFileHash(tmp);
          const stats = await getFileStats(tmp);
          const dedup = await findOrCreateFileHash(tmp, hash, stats.mimeType, stats.size);
          recoveredHash = hash;
          downloadedAndDeduped += 1;

          await prisma.memeAsset.update({
            where: { id: asset.id },
            data: {
              fileUrl: dedup.filePath,
              fileHash: hash,
            },
          });
        } catch {
          downloadFailed += 1;
        }
      }
    }
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
        // Convert public path to absolute path relative to UPLOAD_DIR.
        const fileUrlNow = await prisma.memeAsset.findUnique({ where: { id: asset.id }, select: { fileUrl: true } });
        const publicPath = String(fileUrlNow?.fileUrl || fileUrl);
        if (publicPath.startsWith('/uploads/')) {
          const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
          const rel = publicPath.replace(/^\/uploads\//, '');
          const abs = path.join(uploadsRoot, rel);
          try {
            const st = await fs.promises.stat(abs);
            fileSize = BigInt(st.size);
          } catch {
            // keep 0n
          }
          const ext = path.extname(abs).toLowerCase();
          if (ext === '.webm') mimeType = 'video/webm';
          else if (ext === '.mp4') mimeType = 'video/mp4';
        }

        await prisma.fileHash.upsert({
          where: { hash: recoveredHash },
          create: { hash: recoveredHash, filePath: publicPath, referenceCount: 1, fileSize, mimeType },
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
      String(asset.aiStatus || '') === 'done' && !!asset.aiAutoDescription && asset.aiAutoTagNamesJson != null;
    if (canCopy) {
      if (!dryRun) {
        await prisma.channelMeme.updateMany({
          where: { id: r.id, channelId },
          data: {
            aiAutoDescription: r.aiAutoDescription ? undefined : (asset.aiAutoDescription ?? null),
            aiAutoTagNamesJson:
              r.aiAutoTagNamesJson == null
                ? (asset.aiAutoTagNamesJson as Prisma.InputJsonValue)
                : undefined,
            searchText: r.searchText
              ? undefined
              : (asset.aiSearchText ??
                (asset.aiAutoDescription ? String(asset.aiAutoDescription).slice(0, 4000) : null)),
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
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, aiStatus: true },
    });

    const subId = await (async () => {
      if (existingSub?.id) return existingSub.id;
      if (dryRun) return null;
      const durationMs =
        typeof asset.durationMs === 'number' && Number.isFinite(asset.durationMs) ? asset.durationMs : null;
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
          durationMs,
          aiStatus: 'pending',
        },
        select: { id: true },
      });
      createdSubmissions += 1;
      return created.id;
    })();

    if (!subId) continue;

    if (!dryRun) {
      try {
        await processOneSubmission(subId);
      } catch (e: unknown) {
        processFailed += 1;
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error(
          JSON.stringify(
            {
              event: 'backfill.ai.process_failed',
              channelId,
              channelMemeId: r.id,
              memeAssetId: asset.id,
              submissionId: subId,
              errorMessage,
            },
            null,
            2
          )
        );
        continue;
      }
    }
    processed += 1;

    // Keep the loop cooperative.
    if (processed % batch === 0) {
      console.log(
        JSON.stringify(
          { progress: { i: i + 1, total: missing.length, copied, createdSubmissions, processed } },
          null,
          2
        )
      );
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
          downloadedAndDeduped,
          downloadFailed,
          processFailed,
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
