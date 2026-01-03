import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { validatePathWithinDirectory } from '../utils/pathSecurity.js';
import path from 'path';
import fs from 'fs';
import { normalizeVideoAudioForPlayback } from '../utils/media/normalizeVideoAudio.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isLocalUploadsUrl(u: string | null | undefined): boolean {
  const s = String(u || '').trim();
  return s.startsWith('/uploads/');
}

export function startMemeAssetAudioNormalizationScheduler(): void {
  const enabled = parseBool(process.env.PLAYBACK_AUDIO_NORMALIZATION_ENABLED);
  if (!enabled) return;

  const intervalMs = clampInt(parseInt(String(process.env.PLAYBACK_AUDIO_NORMALIZATION_INTERVAL_MS || ''), 10), 1_000, 60 * 60_000, 30_000);
  const initialDelayMs = clampInt(parseInt(String(process.env.PLAYBACK_AUDIO_NORMALIZATION_INITIAL_DELAY_MS || ''), 10), 0, 60 * 60_000, 10_000);
  const batch = clampInt(parseInt(String(process.env.PLAYBACK_AUDIO_NORMALIZATION_BATCH || ''), 10), 1, 200, 10);
  const stuckMs = clampInt(parseInt(String(process.env.PLAYBACK_AUDIO_NORMALIZATION_STUCK_MS || ''), 10), 5_000, 24 * 60 * 60_000, 10 * 60_000);
  const maxRetries = clampInt(parseInt(String(process.env.PLAYBACK_AUDIO_NORMALIZATION_MAX_RETRIES || ''), 10), 0, 50, 5);

  let running = false;
  const lockId = 921337n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    let locked = false;

    try {
      locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;

      const now = new Date();
      const stuckBefore = new Date(Date.now() - stuckMs);

      const candidates = await prisma.memeAsset.findMany({
        where: {
          type: 'video',
          fileUrl: { not: null },
          OR: [
            { audioNormStatus: 'pending' as any },
            { audioNormStatus: 'failed' as any, OR: [{ audioNormNextRetryAt: null }, { audioNormNextRetryAt: { lte: now } }] },
            { audioNormStatus: 'processing' as any, audioNormLastTriedAt: { lt: stuckBefore } },
          ],
        },
        select: {
          id: true,
          fileHash: true,
          fileUrl: true,
          playFileUrl: true,
          audioNormStatus: true,
          audioNormRetryCount: true,
        } as any,
        take: batch,
        orderBy: { createdAt: 'asc' },
      });

      let claimed = 0;
      let processed = 0;
      let failed = 0;

      const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
      const outDir = path.join(uploadsRoot, 'memes-normalized');

      for (const c of candidates as any[]) {
        if ((c.audioNormRetryCount ?? 0) >= maxRetries) {
          await prisma.memeAsset.update({
            where: { id: c.id },
            data: {
              audioNormStatus: 'failed_final',
              audioNormError: 'max_retries_exceeded',
              audioNormNextRetryAt: null,
            } as any,
          });
          continue;
        }

        // If already has playFileUrl, treat as done (idempotency).
        if (c.playFileUrl) {
          await prisma.memeAsset.update({
            where: { id: c.id },
            data: { audioNormStatus: 'done', audioNormCompletedAt: now, audioNormError: null } as any,
          });
          continue;
        }

        const fileUrl = String(c.fileUrl || '').trim();
        if (!isLocalUploadsUrl(fileUrl)) {
          await prisma.memeAsset.update({
            where: { id: c.id },
            data: { audioNormStatus: 'failed_final', audioNormError: 'non_local_file_url' } as any,
          });
          continue;
        }

        const claim = await prisma.memeAsset.updateMany({
          where: {
            id: c.id,
            type: 'video',
            fileUrl: { not: null },
            OR: [
              { audioNormStatus: 'pending' as any },
              { audioNormStatus: 'failed' as any, OR: [{ audioNormNextRetryAt: null }, { audioNormNextRetryAt: { lte: now } }] },
              { audioNormStatus: 'processing' as any, audioNormLastTriedAt: { lt: stuckBefore } },
            ],
          } as any,
          data: { audioNormStatus: 'processing', audioNormLastTriedAt: now } as any,
        });
        if (claim.count !== 1) continue;
        claimed += 1;

        try {
          const rel = fileUrl.replace(/^\/uploads\//, '');
          const inputPath = validatePathWithinDirectory(rel, uploadsRoot);
          if (!fs.existsSync(inputPath)) throw new Error('missing_file_on_disk');

          const ext = path.extname(inputPath).toLowerCase() || '.webm';
          const baseName = c.fileHash ? String(c.fileHash) : c.id;
          const outPath = path.join(outDir, `${baseName}${ext}`);
          const outPublicUrl = `/uploads/memes-normalized/${baseName}${ext}`;

          await normalizeVideoAudioForPlayback({ inputPath, outputPath: outPath });

          await prisma.memeAsset.update({
            where: { id: c.id },
            data: {
              playFileUrl: outPublicUrl,
              audioNormStatus: 'done',
              audioNormCompletedAt: now,
              audioNormError: null,
              audioNormNextRetryAt: null,
            } as any,
          });

          processed += 1;
        } catch (e: any) {
          failed += 1;
          const prevRetries = Number.isFinite(c.audioNormRetryCount as any) ? (c.audioNormRetryCount as number) : 0;
          const nextRetryCount = prevRetries + 1;
          const backoffMs = Math.min(60 * 60_000, 5_000 * Math.pow(2, Math.max(0, nextRetryCount - 1)));

          await prisma.memeAsset.update({
            where: { id: c.id },
            data: {
              audioNormStatus: nextRetryCount >= maxRetries ? 'failed_final' : 'failed',
              audioNormRetryCount: nextRetryCount,
              audioNormLastTriedAt: now,
              audioNormNextRetryAt: nextRetryCount >= maxRetries ? null : new Date(Date.now() + backoffMs),
              audioNormError: String(e?.message || 'audio_norm_failed'),
            } as any,
          });
        }
      }

      logger.info('playback_audio_norm.completed', {
        batch,
        stuckMs,
        maxRetries,
        claimed,
        processed,
        failed,
        durationMs: Date.now() - startedAt,
      });
    } catch (e: any) {
      logger.error('playback_audio_norm.failed', { errorMessage: e?.message, durationMs: Date.now() - startedAt });
    } finally {
      if (locked) await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  setInterval(() => void runOnce(), Math.max(1_000, intervalMs));
}


