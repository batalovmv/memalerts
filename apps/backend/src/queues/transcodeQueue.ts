import { Queue, type JobsOptions } from 'bullmq';
import { logger } from '../utils/logger.js';
import { getBullmqConnection, getBullmqPrefix } from './bullmqConnection.js';

export const TRANSCODE_QUEUE_NAME = 'video-transcode';
export const TRANSCODE_JOB_NAME = 'video-transcode';

export type TranscodeJobData = {
  memeAssetId: string;
  inputFileUrl: string;
  format: 'preview' | 'webm' | 'mp4';
};

let transcodeQueue: Queue<TranscodeJobData> | null = null;

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isEnabled(): boolean {
  const raw = process.env.TRANSCODE_BULLMQ_ENABLED;
  if (raw === undefined) return true;
  return parseBool(raw);
}

export function getTranscodeQueue(): Queue<TranscodeJobData> | null {
  if (!isEnabled()) return null;
  const connection = getBullmqConnection();
  if (!connection) return null;
  if (!transcodeQueue) {
    transcodeQueue = new Queue<TranscodeJobData>(TRANSCODE_QUEUE_NAME, {
      connection,
      prefix: getBullmqPrefix(),
    });
  }
  return transcodeQueue;
}

export async function enqueueTranscode(
  data: TranscodeJobData
): Promise<{ enqueued: boolean; jobId: string | null }> {
  const queue = getTranscodeQueue();
  if (!queue) return { enqueued: false, jobId: null };

  const jobId = `transcode-${data.format}-${data.memeAssetId}`;
  const jobOptions: JobsOptions = {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60 * 1000 },
    removeOnComplete: true,
    removeOnFail: false,
  };

  try {
    await queue.add(TRANSCODE_JOB_NAME, data, jobOptions);
    logger.info('transcode.queue.enqueued', { memeAssetId: data.memeAssetId, format: data.format, jobId });
    return { enqueued: true, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('exists')) {
      return { enqueued: false, jobId };
    }
    logger.warn('transcode.queue.enqueue_failed', {
      memeAssetId: data.memeAssetId,
      format: data.format,
      errorMessage: message,
    });
    return { enqueued: false, jobId: null };
  }
}
