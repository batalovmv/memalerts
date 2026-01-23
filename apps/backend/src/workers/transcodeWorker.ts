import { Worker } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { getBullmqConnection, getBullmqPrefix } from '../queues/bullmqConnection.js';
import { TRANSCODE_QUEUE_NAME, type TranscodeJobData } from '../queues/transcodeQueue.js';
import { transcodeToFormat, transcodeToPreview } from '../utils/media/videoNormalization.js';
import { VIDEO_FORMATS } from '../utils/media/videoFormats.js';
import { markVariantFailed, upsertMemeAssetVariant } from '../services/memeAsset/variantStore.js';
import { resolveLocalMediaPath } from '../utils/media/resolveMediaPath.js';

export type TranscodeWorkerHandle = {
  stop: (opts?: { timeoutMs?: number }) => Promise<void>;
};

let activeWorker: Worker | null = null;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return await p;
  let t: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export function startTranscodeWorker(): TranscodeWorkerHandle | null {
  const connection = getBullmqConnection();
  if (!connection) return null;

  const worker = new Worker(
    TRANSCODE_QUEUE_NAME,
    async (job) => {
      const data = job.data as TranscodeJobData | null;
      const memeAssetId = String(data?.memeAssetId || '').trim();
      const inputFileUrl = String(data?.inputFileUrl || '').trim();
      const format = String(data?.format || '').trim() as TranscodeJobData['format'];

      if (!memeAssetId || !inputFileUrl || !format) {
        logger.warn('transcode.queue.bad_job', { jobId: job.id });
        return;
      }

      let tempDir: string | null = null;
      const resolved = await resolveLocalMediaPath(inputFileUrl);
      if (!resolved) {
        logger.warn('transcode.queue.source_missing', { memeAssetId, jobId: job.id, inputFileUrl });
        throw new Error('transcode_source_missing');
      }

      try {
        tempDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'uploads', 'temp', `${format}-`));
        const baseName = `meme-${memeAssetId}-${Date.now()}`;
        const result = await withTimeout(
          format === 'preview'
            ? transcodeToPreview(resolved.localPath, tempDir, baseName, { lowPriority: true })
            : transcodeToFormat(resolved.localPath, tempDir, format, baseName, { lowPriority: true }),
          10 * 60_000,
          'transcode'
        );

        const config = VIDEO_FORMATS[format];
        await upsertMemeAssetVariant({
          memeAssetId,
          format,
          codec: config.codecString,
          container: config.container,
          mimeType: config.mimeType,
          outputPath: result.outputPath,
          fileHash: result.fileHash,
          fileSizeBytes: result.fileSizeBytes,
          durationMs: result.durationMs,
          width: result.width,
          height: result.height,
          priority: config.priority,
        });

        logger.info('transcode.queue.done', { memeAssetId, format, jobId: job.id });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await markVariantFailed({ memeAssetId, format, errorMessage: errMsg });
        logger.warn('transcode.queue.failed', { memeAssetId, format, jobId: job.id, errorMessage: errMsg });
        throw error;
      } finally {
        try {
          await resolved.cleanup();
        } catch {
          // ignore
        }
        if (tempDir) {
          try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      }
    },
    {
      connection,
      prefix: getBullmqPrefix(),
      concurrency: 2,
    }
  );

  worker.on('error', (err) => {
    const error = err as { message?: string };
    logger.error('transcode.queue.worker_error', { errorMessage: error?.message || String(err) });
  });

  worker.on('failed', (job, err) => {
    logger.warn('transcode.queue.job_failed', {
      memeAssetId: job?.data?.memeAssetId ?? null,
      jobId: job?.id ?? null,
      format: job?.data?.format ?? null,
      errorMessage: err?.message || String(err),
    });
  });

  activeWorker = worker;

  return {
    stop: async (opts?: { timeoutMs?: number }) => {
      if (!activeWorker) return;
      const timeoutMs = opts?.timeoutMs;
      try {
        if (Number.isFinite(timeoutMs) && Number(timeoutMs) > 0) {
          await withTimeout(activeWorker.close(), Number(timeoutMs), 'transcode_worker_close');
        } else {
          await activeWorker.close();
        }
      } finally {
        activeWorker = null;
      }
    },
  };
}
